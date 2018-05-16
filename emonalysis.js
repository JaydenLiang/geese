var fs = require('fs');
var https = require('https');
var http = require('http');

function Emonalysis(app_id, app_key){
    this.app_id = app_id;
    this.app_key = app_key;
};

/**
src_options.

return json
*/
Emonalysis.prototype.postMedia = function(src_options) {
    console.log(`call postMedia`);
    var source = src_options.file_uri;
  // console.log("callKairosEmotionAnalysis: uri:", source);
  // return Promise.resolve(result);
  var options = {
   host: 'api.kairos.com',
   port: 443,
   path: '/v2/media?source='+source,
   method: 'POST',
   headers: {
    app_id: this.app_id,
    app_key: this.app_key,
}
};
return new Promise((resolve, reject) => {
    https.request(options, function (res) {
      var body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
          body += chunk;
      });
      res.on('end', function () {
        body = JSON.parse(body);
        resolve(body);
    });
  }).on('error', (e) => {
      reject(null);
  }).end();
});
};
// commonjs
module.exports = Emonalysis;
// es6 default export compatibility
module.exports.default = module.exports;