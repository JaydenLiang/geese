var AWS = require('aws-sdk');
var fs = require('fs');
var https = require('https');
var http = require('http');

function S3Uploader(){
  var s3_bucket;
  var s3_region;
};

S3Uploader.prototype.setBucket = function (region, bucket){
  this.s3_bucket = bucket;
  this.s3_region = region;
  return this;
};

S3Uploader.prototype.getBucketHostURL = () => {
  return "http://" +this.s3_bucket + '.s3-website-'+this.s3_region+'.amazonaws.com/';
};

S3Uploader.prototype.retrieveFile = (src_options) => {
  return new Promise((resolve, reject)=>{
    var local_path = '/tmp/File_by_S3Uploader_' + Date.now() + Math.round(Math.random() * 1000);
    var fileWriter = fs.createWriteStream(local_path);
    https.get(src_options, function(response) {
      console.log("remote file received.");
      response.pipe(fileWriter)
      .on('finish', function(){
        console.log("Remote file is written to:", local_path);
        resolve({local_path: local_path, file_name: src_options.file_name});
      })
      .on('error', (e) => {
        console.log("fs writer failed with error.");
        console.error(e);
        reject({has_error:true, params: src_options});
      });
    }).on('error', (e) => {
      console.log("https.get failed with error.");
      console.error(e);
      reject({has_error:true, params: src_options});
    });
  });
};

S3Uploader.prototype.saveToS3Bucket = (des_options) => {
  return new Promise((resolve, reject)=>{
    var local_file = des_options.local_path;
    fs.readFile(local_file, (err, data) => {
      if (err) {
        reject({has_error:true, error: err, params: des_options});
        return;
      }
      var base64data = new Buffer(data, 'binary');
      var s3 = new AWS.S3();
      s3.putObject({
        Bucket: des_options.s3_bucket,
        Key: des_options.file_name,
        Body: base64data,
        ACL: 'public-read'
      },function (err, data) {
        fs.unlink(local_file);
        if(err){
          console.log(err);
          reject(err);
          return;
        }
        console.log('File is uploaded to S3');
        //http://krouze-geese-image-temp.s3-website-us-west-2.amazonaws.com
        var s3_url = "http://" +des_options.s3_bucket + '.s3-website-'+des_options.s3_region+'.amazonaws.com/';
        resolve({file_name: des_options.file_name, file_uri: s3_url + des_options.file_name});
      });
    });
  }).catch((err)=>{
    console.log(`error caught 1`);
  });
};


// commonjs
module.exports = S3Uploader;
// es6 default export compatibility
module.exports.default = module.exports;