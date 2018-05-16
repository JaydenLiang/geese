/* eslint-disable no-console */
const qs = require('querystring');
const fetch = require('node-fetch');
const https = require('https');

// Get JUST the Slack event.
const parseEvent = (event) => {
  console.log("call parseEvent()", event);
  return { slack: event };
};

const getXConvertCommand = text => /^<@[A-Z0-9]*>(.+)/.exec(text)[1].trim();

const parseXConvertCommand = (command) => {
  const pattern = /[a-z\s]*(\d+).*([a-z]{3}).*([a-z]{3})/i;
  const matches = command.match(pattern);
  if (matches) {
    return {
      amount: +matches[1],
      source: matches[2],
      target: matches[3],
    };
  }
  return null;
};

// Make an API call to http://fixer.io/
const callFixer = (command) => {
  const url = `https://api.fixer.io/latest?base=${command.source}&symbols=${command.target}`;
  console.log(`Requesting ${url}`);
  return fetch(url)
  .then(response => response.json())
  .then((json) => {
    if (json.error === 'Invalid base') {
      return `No rates found for currency "${command.source}"`;
    }
    if (!json.rates[command.target]) {
      return `No rates found for currency "${command.target}"`;
    }
    const result = json.rates[command.target] * command.amount;
    const displayResult = parseFloat(Math.round(result * 100) / 100).toFixed(2);
    return `${command.amount}${command.source} is ${displayResult}${command.target}`;
  });
};

const guessService = (event) => {
  if(event == null || event.slack == null || event.slack.event == null || event.slack.event.text == null){
    console.log("guess service failed. Invalid event: ",event);
    return null;
  }
  const message = event.slack.event.text;
  if(isSvcXConvert(message)){
    console.log("Guess and call service: XConvert.");
    return callSvcXConvert(event);
  }
  else if(isSvcEmonalysis(message)){
    console.log("Guess and call service: Emonalysis.");
    return callSvcEmonalysis(event);
  }
  else{
    console.log("Default respond because no matches service found in event: ", event);
    return callSvcDefaultResponse(event);
  }
}

const isSvcXConvert = (text) => {
  if(text.toLowerCase().indexOf('convert currency') >= 0){
    return true;
  }
  return false;
}

const isSvcEmonalysis = (text) => {
  if(text.toLowerCase().indexOf('what do you think') >= 0){
    return true;
  }
  return false;
}

//generate a default response to the command.
const callSvcDefaultResponse = (event) => {
  const defaultReply = `Hey <@${event.slack.event.user}>, what can I do for you?`;
  return Object.assign(event, { reply: defaultReply });
};

// Generate a response to the command.
const callSvcXConvert = (event) => {
  const rawCommand = event.slack.event.text;
  const command = getXConvertCommand(rawCommand);
  const convertCommand = parseXConvertCommand(command);
  if (convertCommand) {
    return callFixer(convertCommand)
    .then((reply) => {
      reply = `<@${event.slack.event.user}> ` + getFillerWords() + " I'm pretty sure " + reply + " recently.";
      return Object.assign(event, { reply });
    });
  }
  const defaultReply = `I'm sorry, I am not sure if you want me to convert currency for you."
  Please tell me like "convert currency 1CAD to USD"`;
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
  //set the image to be public accessible
  return Promise.resolve(event)
  .then(sharedPublicURL)
  //do the Kairos emotion analysis
  .then(callKairosEmotionAnalysis)
  //set the image to private again
  .then((result) => {
    //if image was public shared, don't revoke it public shared status
    if(result.file.public_shared == false){
      return revokePublicURL(result);
      // return Promise.resolve(result);
    }
    else{
      return Promise.resolve(result);
    }
  })
  //return
  .then(function(result){
    // console.log("response result.emonalysis ", result.emonalysis);
    // console.log("response result.emonalysis.filepath ", result.emonalysis.filepath);
    // console.log("response result.emonalysis.analysis.frames[0] ", result.emonalysis.analysis.frames[0]);
    // console.log("response result.emonalysis.analysis.frames[0].people ", result.emonalysis.analysis.frames[0].people);
    reply = `<@${result.event.slack.event.user}> ` + getFillerWords();
    if(result.emonalysis == null | result.emonalysis.analysis.frames[0].people.length == 0){
      reply += " I don't know if I can see clearly but is there any people in this picture?";
    }
    else{
      var people = result.emonalysis.analysis.frames[0].people[0];
      reply += " I would say, from my understanding, the person in the picture is a ";
      reply += (people['demographics']['gender']).toLowerCase();
      reply += " " + (people['demographics']['age_group']).toLowerCase();
      reply += ", and it looks " + getEmotionDescription(people['emotions']);
      reply += ". Do you agree?";
    }
    return Object.assign(result.event, { reply: reply});
  })
  .catch(function(error){
    return Object.assign(error.event, { reply: "hmm.. I can't think at this moment." });
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

const callKairosEmotionAnalysis = (result) => {
  return new Promise((resolve, reject) => {
    var filename = result.file.filename;
    var realpath = result.file.real_path;
    var uri = "https://jhi8swd1v9.execute-api.us-west-2.amazonaws.com/dev/emonalysis?";
    var req_url = uri + "filename="+filename+"&source="+realpath;
    console.log("callKairosEmotionAnalysis: uri -> ", req_url);
    https.get(req_url, function (res) {
      var body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', function () {
        body = JSON.parse(body);
        result.emonalysis = body;
        console.log("callKairosEmotionAnalysis result:", result);
        resolve(result);
      });
    }).on('error', (e) => {
      // console.log("sharedPublicURL request error.");
      result.ok = false;
      reject(result);
    }).end();;
  });
};

var getEmotionDescription = (emotions) => {
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
const sendResponse = (event) => {
  console.log("rsendResponse: ", event);
  const params = {
    token: event.team.bot.bot_access_token,
    channel: event.slack.event.channel,
    text: event.reply,
  };
  const url = `https://slack.com/api/chat.postMessage?${qs.stringify(params)}`;
  console.log(`Requesting ${url}`);
  return fetch(url)
  .then(response => response.json())
  .then((response) => {
    if (!response.ok) throw new Error('SlackAPIError');
    return Object.assign(event, { response });
  });
};

module.exports.handler = (event, context, callback) =>
  Promise.resolve(event) // Start the promise chain
  .then(parseEvent)
  .catch(callback); // Error

// module.exports.handler = (event, context, callback) => log(event)
//   .then(guessService) // Attempt the command
//   .then(sendResponse) // Update the channel
//   .then(() => callback(null)) // Sucess
//   .catch(callback); // Error
