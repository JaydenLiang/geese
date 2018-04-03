var AWS = require('aws-sdk');
var fs = require('fs');
var https = require('https');
var http = require('http');

var uploadImage = (uri, saveName) => {
  return new Promise(function(resolve, reject){
    https.get(uri, (res) => {
      var fileName = 'krouze_geese_' + Date.now() + Math.round(Math.random() * 1000);
      var s3_bucket = process.env.S3_BUCKET;
      var filePath = '/tmp/' + fileName;
      var writer = fs.createWriteStream(filePath);
      //   console.log('statusCode:', res.statusCode);
      //   console.log('headers:', res.headers);
        res.pipe(writer).on('finish', function(){
            console.log(filePath + " is written.");
            fs.readFile(filePath, function (err, data) {
              if (err) { throw err; }
            
              var base64data = new Buffer(data, 'binary');
            
              var s3 = new AWS.S3();
              s3.putObject({
                Bucket: s3_bucket,
                Key: saveName,
                Body: base64data,
                ACL: 'public-read'
              },function (resp) {
                fs.unlink(filePath);
                console.log('Successfully uploaded file.');
                //http://krouze-geese-image-temp.s3-website-us-west-2.amazonaws.com
                var s3_url = "http://" +s3_bucket + '.s3-website-'+process.env.S3_REGION+'.amazonaws.com/';
                resolve({filename: saveName, filepath: s3_url + saveName});
              });
          });
        });
      }).on('error', (e) => {
        console.error(e);
        reject({filename: saveName, filepath: s3_bucket + '/' + saveName});
      });
    });
};

const callKairosEmotionAnalysis = (uri, result) => {
  var source = uri;
  // console.log("callKairosEmotionAnalysis: uri:", source);
  // return Promise.resolve(result);
  var options = {
   host: 'api.kairos.com',
    port: 443,
    path: '/v2/media?source='+source,
    method: 'POST',
    headers: {
        app_id: process.env.KAIROS_APP_ID,
        app_key: process.env.KAIROS_APP_KEY,
      }
  };
  console.log("callKairosEmotionAnalysis source:" + source);
  return new Promise((resolve, reject) => {
    https.request(options, function (res) {
      var body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
          body += chunk;
      });
      res.on('end', function () {
        body = JSON.parse(body);
        console.log("callKairosEmotionAnalysis:", body);
        result.analysis = body;
        result.ok = true;
        resolve(result);
      });
    }).on('error', (e) => {
      console.log("sharedPublicURL request error.");
      result.ok = false;
      result.analysis = null;
      reject(result);
    }).end();
  });
};

var removeImage = (filename, result) => {
  return new Promise(function(resolve, reject){
    var s3_bucket = process.env.S3_BUCKET;
    var s3 = new AWS.S3();
    var params = {
      Bucket: s3_bucket, 
      Key: filename
    };
    s3.deleteObject(params, function(err, data) {
      if (err){
        console.log(err, err.stack); // an error occurred
        reject(err);
      }
      else{
        console.log("File "+filename+" is removed from s3 bucket: " + s3_bucket);
        resolve(result);
      }
    });
  });
};

exports.handler = (event, context, callback) => {
    // TODO implement
    console.log("event:", event);
    var analysis;
    if(event.queryStringParameters === null || event.queryStringParameters.source === null
      || event.queryStringParameters.filename === null){
      callback(null, "error: not enough parameters.");
      return;
    }
    var source = event.queryStringParameters.source;
    var name = event.queryStringParameters.filename;

    var file1 = "https://files.slack.com/files-pri/T7BC821FA-F82LJR4P4/testface.jpeg?pub_secret=a293cdb50a";
    var file2 = "http://krouze-geese-image-temp.s3-website-us-west-2.amazonaws.com/testface.jpeg";

    uploadImage(source, name).then((result)=>{
      // callback("file is saved to: " + result.filepath);
      return callKairosEmotionAnalysis(result.filepath, result);
    }).then((result)=>{
      // callback("file is saved to: " + result.filepath);
      return removeImage(result.filepath, result);
    }).then((result)=>{
      var response = {
        "statusCode": 200,
        "headers": {
            'Content-Type': 'application/json'
        },
        "body": JSON.stringify(result)
    };
      callback(null, response);
    });
    
};