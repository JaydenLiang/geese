/**
Configuration:
# store lambda function environment variables for slack app
## store CLIENT_ID (find in your slack app in https://api.slack.com/apps/ > basic information)
# modify api gateway
## from request method, map the query pamareter 'state' to integration request body mapping template: {"state":"$input.params('state')"}
## setup response to return html (see: https://kennbrodhagen.net/2016/01/31/how-to-return-html-from-aws-api-gateway-lambda/)
*/

const getState = (event) => {
  console.log(`call getState with event`, event);
  var state = 'new';
  if (event && event.state) {
    state = event.state;
}
return state;
};

const run = (state, event, context, callback) => {
    console.log(`call run with state, event`, state, event);
    var htmlString = '';
    switch (state) {
        case 'success':
        htmlString = `<p>Krouze Geese is now ready for your command :D</p>`;
        callback(null, htmlString);
            // code
            break;
            case 'error':
            //code
            errorResponse(null, callback);
            break;
            default:
            // code
            var client_id = process.env.CLIENT_ID;
            htmlString = `<p>This is Krouze Geese - an emotion analyst (bot), powered by Jay de Lion</p><a href="https://slack.com/oauth/authorize?scope=bot&client_id=${client_id}"><img alt="Add to Slack" height="40" width="139" src="https://platform.slack-edge.com/img/add_to_slack.png" srcset="https://platform.slack-edge.com/img/add_to_slack.png 1x, https://platform.slack-edge.com/img/add_to_slack@2x.png 2x" /></a>`;
            console.log('html:', htmlString, context, callback);
            callback(null, htmlString);
        }
    };

    const errorResponse = (error, callback) => {
        callback(null, `<p>Error occured</p>`);
    };

    exports.handler = (event, context, callback) => {
        Promise.resolve(event)
    .then(getState) // Get state from event
    .then(state =>run(state, event, context, callback)) // Run this program on different given states
    .catch(error => errorResponse(error, callback));
};