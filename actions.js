/**
Configuration:
# store lambda function environment variables for slack app
## store API_GATEWAY_ENDPOINT for aws api gateway end point
# store INSTALL_SUCCESS_URL, INSTALL_ERROR_URL for installation handlers.
# store S3_REGION, S3_BUCKET for s3 bucket uses
# store KAIROS_APP_ID, KAIROS_APP_KEY for kairo api calls
# modify api gateway
## check 'Use Lambda Proxy integration' for the GET method
# IAM role permissions:
## dynamodb:List, ReadItem, PutItem
## Lambda timeout should set to >= 10 seconds for network delay tolerance.
*/

/* eslint-disable no-console */
const qs = require('querystring');
const url = require('url');
const fetch = require('node-fetch');
const https = require('https');
const AWS = require('aws-sdk');
const S3Uploader = require('S3Uploader');
const Emonalysis = require('Emonalysis');

const dynamodb = new AWS.DynamoDB.DocumentClient();

// Get JUST the Slack event.
const parseEvent = (event) => {
  console.log("call parseEvent()");
  return event;
};

const guessService = (event) => {
  if(event == null || event.slack == null || event.slack.event == null || event.slack.event.text == null){
    console.log("guess service failed. Invalid event: ",event);
    return null;
  }
  const message = event.slack.event.text;
  if(isSvcEmonalysis(message)){
    console.log("Guess and call service: Emonalysis.");
    return callSvcEmonalysis(event);
  }
  else{
    console.log("Default respond because no matches service found in event: ", event);
    return callSvcDefaultResponse(event);
  }
}

const isSvcEmonalysis = (text) => {
  console.log("call isSvcEmonalysis", text);
  if(text.toLowerCase().indexOf('what do you think') >= 0){
    return true;
  }
  else if(text.toLowerCase().indexOf('who it is') >= 0){
    return true;
  }
  else if(text.toLowerCase().indexOf('emonalysis') >= 0){
    return true;
  }
  return false;
}

//generate a default response to the command.
const callSvcDefaultResponse = (event) => {
  const defaultReply = `Hey <@${event.slack.event.user}>, what can I do for you?`;
  return Object.assign(event, { reply: defaultReply });
};

/**
* parse the real path of the image from the file
*/
function parseSlackImagePublicURL(file){
  if(file == null || file.is_public == false){
    return null;
  }
  var secret = file.permalink_public.substring(file.permalink_public.lastIndexOf('-')+1);
  return file.url_private + "?pub_secret="+secret;
}

//Service Emonalysis
const callSvcEmonalysis = (event) => {
  console.log(`call callSvcEmonalysis`);
  sendResponse(event, {type:"message", message: "No problem! Give me a moment please."});
  return Promise.resolve(event)
  //fetch chat history
  .then(fetchIMHistory)
  //find the last uploaded file
  .then((messages)=>findLastUploadFileInIM(event, messages, 5))
  //upload it to S3 bucket for emotion analysis
  .then((message)=>{
    console.log(`after findLastUploadFileInIM`);
    if(message){
      sendResponse(event, {type:"message", message: "Yeah, I found the photo you gave me. I'll look closely into it. Just give me a few more seconds."});
      return uploadFileToS3Bucket(event, message);
    }
    else{
      sendResponse(event, {type:"message", message: "hmm.. I can't find any uploaded image recently."});
      //TODO
      //what to reject?
      return Promise.reject();
    }
  })
  //test
  .then((des_options)=>{
    console.log(`test after uploadFileToS3Bucket`, des_options);
    return des_options;
  })
  //do the Kairos emotion analysis
  .then(callKairosEmotionAnalysis)
  //remove the image source from S3 bucket
  // .then((result) => {
  //   //if image was public shared, don't revoke it public shared status
  //   if(result.file.public_shared == false){
  //     return revokePublicURL(result);
  //     // return Promise.resolve(result);
  //   }
  //   else{
  //     return Promise.resolve(result);
  //   }
  // })
  //generate report and respond
  .then((result)=>respondWithEmonalysisReport(event, result))
  //catch error and respond
  .catch(function(error){
    console.log("catch error in callSvcEmonalysis", error);
    // return Object.assign(error.event, { reply: "hmm.. I can't think at this moment." });
    sendResponse(error.event, {type:"message", message: "hmm.. I can't think at this moment."});
  });
};

const sharedPublicURL = (event) => {
  var file_name = event.slack.event.file.id;
  var orig_name = event.slack.event.file.name;
  var public_shared = event.slack.event.file.public_url_shared;
  var token = process.env.SLACK_LEGACY_TOKEN;
  var req_url = "https://slack.com/api/files.sharedPublicURL?";
  
  req_url += "token="+token;
  req_url += "&file="+file_name;
  req_url += "&pretty=1";

  if(public_shared){
    return Promise.resolve({ok: true, event: event
      , file: {filename:file_name +"_"+orig_name, public_url: event.slack.event.file.permalink
      , real_path: parseSlackImagePublicURL(event.slack.event.file)
      , public_shared: public_shared}
    });
  }

  return new Promise((resolve, reject) => {
    https.request(req_url, function (res) {
      var body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', function () {
        body = JSON.parse(body);
        // console.log("sharedPublicURL url: ", req_url);
        // console.log("sharedPublicURL: ", body);
        if(body == null || body.ok === null){
          //return {ok:true, message: ""};
          reject({ok: false, event: event});
        }
        else{
          if(body.ok === false){
            if(body.error === 'already_public'){
              console.log("sharedPublicURL: public_url = " + parseSlackImagePublicURL(event.slack.event.file));
              resolve({ok: true, event: event
                , file: {filename:file_name +"_"+orig_name, public_url: event.slack.event.file.permalink
                , real_path: parseSlackImagePublicURL(event.slack.event.file)
                , public_shared: public_shared}
              });
            }
            else{
              reject({ok: false, event: event});
            }
          }
          else{
            console.log("sharedPublicURL: public_url = " + parseSlackImagePublicURL(body.file) );
            resolve({ok: true, event: event
              , file: {filename:file_name +"_"+orig_name, public_url: body.file.permalink
              , real_path: parseSlackImagePublicURL(body.file)
              , public_shared: public_shared}
            });
          }          
        }
      });
    }).on('error', (e) => {
      console.log("sharedPublicURL request error.");
      reject({ok: false, event: event});
    }).end();
  });
};

const revokePublicURL = (result) => {
  var file_name = result.event.slack.event.file.id;
  var orig_name = result.event.slack.event.file.name;
  var permalink_public = result.event.slack.event.file.permalink;
  var public_shared = result.event.slack.event.file.public_url_shared;
  var token = process.env.SLACK_LEGACY_TOKEN;
  var req_url = "https://slack.com/api/files.revokePublicURL?";
  req_url += "token="+token;
  req_url += "&file="+file_name;
  req_url += "&pretty=1";

  return new Promise((resolve, reject) => {
    https.request(req_url, function (res) {
      var body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', function () {
        body = JSON.parse(body);
        if(body == null || body.ok == null || body.ok == false){
          //return {ok:true, message: ""};
          result.ok = false;
          console.log("revokePublicURL result: ", result);
          reject(result);
        }
        else{
          //return {ok:false, message: "request error."};
          result.ok = true;
          console.log("revokePublicURL result: ", result);
          resolve(result);
        }
      });
    }).on('error', (e) => {
      console.log("sharedPublicURL request error.");
      result.ok = false;
      reject(result);
    }).end();
  });
};

// const callKairosEmotionAnalysis = (result) => {
//   return new Promise((resolve, reject) => {
//     var filename = result.file.filename;
//     var realpath = result.file.real_path;
//     var uri = "https://jhi8swd1v9.execute-api.us-west-2.amazonaws.com/dev/emonalysis?";
//     var req_url = uri + "filename="+filename+"&source="+realpath;
//     console.log("callKairosEmotionAnalysis: uri -> ", req_url);
//     https.get(req_url, function (res) {
//       var body = '';
//       res.setEncoding('utf8');
//       res.on('data', (chunk) => {
//         body += chunk;
//       });
//       res.on('end', function () {
//         body = JSON.parse(body);
//         result.emonalysis = body;
//         console.log("callKairosEmotionAnalysis result:", result);
//         resolve(result);
//       });
//     }).on('error', (e) => {
//       // console.log("sharedPublicURL request error.");
//       result.ok = false;
//       reject(result);
//     }).end();;
//   });
// };

var getSentiment = (emotions) => {
  var significant = "";
  var max = 0;
  if(emotions.anger >= max){
    max = emotions.anger;
    significant = "angry";
  }
  if(emotions.disgust >= max){
    max = emotions.disgust;
    significant = "disgusted";
  }
  if(emotions.fear >= max){
    max = emotions.fear;
    significant = "feared";
  }
  if(emotions.joy >= max){
    max = emotions.joy;
    significant = "joyful";
  }
  if(emotions.sadness >= max){
    max = emotions.sadness;
    significant = "sad";
  }
  if(emotions.surprise >= max){
    max = emotions.surprise;
    significant = "surprised";
  }
  return significant;
};

var getFillerWords = () => {
  var fillers = ['Hmm....', "My brain can't think.", "I'm a bit busy helping others.", "I'm feeling better now.", "Please don't mind."
  , "I need to get off this planet ASAP but at this moment", "Sun's getting real low...", "Try 'point break' if you need an access code."];
  var index = Math.floor(Math.random() * fillers.length);
  return fillers[index];
};

// Send a response via Slack.
// seems that bot access token was lost but it's required to send message
// token begin with oxop-xxxx-xxxxxx
// see https://api.slack.com/docs/slack-button
// const sendResponse = (event) => {
//   console.log("rsendResponse: ", event);
//   const params = {
//     token: event.team.bot.bot_access_token,
//     channel: event.slack.event.channel,
//     text: event.reply,
//   };
//   const url = `https://slack.com/api/chat.postMessage?${qs.stringify(params)}`;
//   console.log(`Requesting ${url}`);
//   return fetch(url)
//   .then(response => response.json())
//   .then((response) => {
//     if (!response.ok) throw new Error('SlackAPIError');
//     return Object.assign(event, { response });
//   });
// };
const sendResponse = (event, response) => {
  console.log("call sendResponse", event, response);
  const params = {
    token: event.team_app.bot.bot_access_token,
    channel: event.slack.event.channel,
    text: response.message,
  };
  const url = `https://slack.com/api/chat.postMessage?${qs.stringify(params)}`;
  console.log(`Requesting ${url}`);
  return fetch(url)
  // .then(result => result.json())
  .then((result) => {
    var response = result.json();
    if (!response.ok){
      console.log("error while call sendResponse", response);
    }
    return response;
  });
};

/*
new 2018/05/13
*/
const fetchAndComposeImage = (event) => {
  console.log(`call fetchAndComposeImage`);
  const params = {
    token: event.team.bot.bot_access_token,
  };
};

const fetchIMHistory = (event) => {
  console.log(`call fetchIMHistory`);
  const params = {
    token: event.team_app.bot.bot_access_token,
    channel: event.slack.event.channel,
    count: 25,
  };
  const url = `https://slack.com/api/im.history?${qs.stringify(params)}`;
  // console.log(`fetch url`, url);
  return fetch(url)
  .then(response => response.json())
  .then((response) => {
    // console.log(`fetch result`, response);
    if (!response.ok) throw new Error('SlackAPIError');
    return response.messages;
  });
};

const findLastUploadFileInIM = (event, messages, limit) => {
  console.log(`call findLastUploadFileInIM`);
  var count = 0;
  for(var i = 0; i < messages.length; i ++){
    if(messages[i].type == 'message' && messages[i].user != event.team_app.bot.bot_user_id){
      count ++;
      // console.log(`count `, count);
      if(messages[i].subtype == 'file_share' ){
        console.log(`found uploaded file`);
        return messages[i];
      }
      else if(count == limit){
        return null;
      }
    }
  }
  return null;
}

/**
*/
const uploadFileToS3Bucket = (event, message) => {
  // console.log(`call uploadFileToS3Bucket`, event, message);
  return new Promise((resolve, reject)=>{
    if(message == null){
      console.log(`no valid message containing file to upload`);
      //TODO
      //what is the data structure should reject here?
      return reject({});
    }
    var imageURL = url.parse(message.file.url_private);
    var src_options = {
      hostname: imageURL.hostname,
      method: 'GET',
      path: imageURL.path,
      headers: { 'Authorization': "Bearer "+ event.team_app.bot.bot_access_token }
    };
    var uploader = (new S3Uploader());
    //retrieve slack file to local
    uploader.retrieveFile(src_options).then((des_options)=>{
      des_options.s3_region = process.env.S3_REGION;
      des_options.s3_bucket = process.env.S3_BUCKET;
      des_options.file_name = message.file.name;
      console.log(`des_options #1`, des_options);
      uploader.saveToS3Bucket(des_options).then((des_options)=>{
        console.log(`des_options #2`,des_options);
        resolve(des_options);
      });
      // return Promise.resolve(uploader.saveToS3Bucket(des_options));
    });
  });
};

const callKairosEmotionAnalysis = (src_options) => {
  console.log(`call callKairosEmotionAnalysis`);
  var emonalysis = new Emonalysis(process.env.KAIROS_APP_ID, process.env.KAIROS_APP_KEY);
  return emonalysis.postMedia(src_options);
};

const respondWithEmonalysisReport = (event, result) => {
  console.log(`call respondWithEmonalysisReport` ,event, result);
  var reply = `<@${event.slack.event.user}> ` + getFillerWords();
  if(result == null || result.frames == null || result.frames.length == 0 || result.frames[0].people.length == 0){
    reply += " I don't know if I can see clearly but is there any people in this image?";
  }
  else{
    var people = result.frames[0].people;
    reply += ` I found ${people.length} people in the image. 
    I would say, from my analysis, `;
    for(var i = 0; i < people.length; i ++){
      var num = '';
      if(i == 0) num = 'first';
      else if(i == 1) num = 'second';
      else if(i == 2) num = 'third';
      else{
        num = i - 1;
        num = `${num}th`;
      }
      var gender = (people[i]['demographics']['gender']).toLowerCase();
      var sentiment = getSentiment(people[i]['emotions']);
      reply += `the ${num} person in the image is a ${gender} , and it looks ${sentiment};`;
    }
    reply += ". Do you agree?";
  }
  sendResponse(event, {type:"message", message: reply});
};

module.exports.handler = (event, context, callback) =>
Promise.resolve(event) // Start the promise chain
.then(parseEvent)
.then(guessService) // Attempt the command
.catch(callback); // Error

// module.exports.handler = (event, context, callback) => log(event)
//   .then(guessService) // Attempt the command
//   .then(sendResponse) // Update the channel
//   .then(() => callback(null)) // Sucess
//   .catch(callback); // Error
