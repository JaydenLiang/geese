var AWS = require('aws-sdk');
var fs = require('fs');
var https = require('https');
var http = require('http');

var fileName = 'krouze_geese_' + Date.now() + Math.round(Math.random() * 1000);
var filePath = '/tmp/' + fileName;

var writer = fs.createWriteStream(filePath);

exports.handler = (event, context, callback) => {
    // TODO implement
    var file1 = "https://files.slack.com/files-pri/T7BC821FA-F82LJR4P4/testface.jpeg?pub_secret=a293cdb50a";
    var file2 = "http://krouze-geese-image-temp.s3-website-us-west-2.amazonaws.com/testface.jpeg";
    https.get(file1, (res) => {
    //   console.log('statusCode:', res.statusCode);
    //   console.log('headers:', res.headers);
      res.pipe(writer).on('finish', function(){
          console.log(filePath + " is written.");
          fs.readFile(filePath, function (err, data) {
          if (err) { throw err; }
        
          var base64data = new Buffer(data, 'binary');
        
          var s3 = new AWS.S3();
          s3.putObject({
            Bucket: 'krouze-geese-image-temp',
            Key: '123456.jpeg',
            Body: base64data,
            ACL: 'public-read'
          },function (resp) {
            fs.unlink(filePath);
            console.log(arguments);
            console.log('Successfully uploaded package.');
          });
        
        });
      });
    
    }).on('error', (e) => {
      console.error(e);
    });
};