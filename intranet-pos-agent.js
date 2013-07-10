var path = require('path');
var amqp = require('amqp');
var fs = require('fs');
var https = require('https');
var EventEmitter = require('events').EventEmitter;

var connection = amqp.createConnection({url: process.env.RABBITMQ_URL});
var requestReady =  new EventEmitter();

// Step 1: Establishes a conenction with RabbitMQ and
//         sits in an infinite loop listening for jobs.
connection.on('ready', function(){
  connection.queue(process.env.REQUEST_QUEUE, {autoDelete: false, passive: true}, function(queue){
    queue.bind(process.env.REQUEST_QUEUE);
    console.log('[*] Waiting for request. To exit press CTRL+C');

    queue.subscribe(function(msg,headers,deliveryInfo){
      // called once per message being picked off RabbitMQ
      // so its request-scoped in a manner of speaking
      optionsSetup(msg, headers, deliveryInfo);
    });
  });
});    


var getReadOnlyConnectionOptions = function() {
  return {
    host: process.env.SERVER_HOST,
    port: process.env.SERVER_PORT,
    //ca: [fs.readFileSync('')],
    rejectUnauthorized: false,
    base64Encoded: ,
    path: '', // per request-scope variable
    method: 'GET', // per request-scope variable
    headers: {
        "User_Agent":"",
        "X_PAPPID":"",
        "Accept-Encoding": ""
    }, 
    auth: process.env.SERVER_USERNAME + ":" + process.env.SERVER_PASSWORD
  };
};

var getReadWriteConnectionOptions = function() {
  return {
    host: process.env.SERVER_HOST,
    port: process.env.SERVER_PORT,
    //ca: [fs.readFileSync('')],
    rejectUnauthorized: false,
    path: '', // per request-scope variable
    method: '', // per request-scope variable
    headers: {
        "User_Agent":"",
        "X_PAPPID": "",
        "Accept-Encoding": ""
    },
    auth: process.env.SERVER_USERNAME + ":" + process.env.SERVER_PASSWORD
  };
};

// request-scoped method - a different instance of this method
// will be called per incoming job from RabbitMQ
var optionsSetup = function(msg, headers, deliveryInfo){
  var connectionOptions;
  var base64Encoded = msg.base64Encoded;
  if (msg.requestMethod==="GET" ||
      msg.requestMethod==="get")
  {
    connectionOptions = getReadOnlyConnectionOptions();
  } else {
   connectionOptions = getReadWriteConnectionOptions();
  }
  //connectionOptions.headers.User_Agent=headers.User-Agent;
  //connectionOptions.headers.X_PAPPID=headers.X-PAPPID;
  connectionOptions.headers=msg.requestHeaders;
  connectionOptions.path = msg.requestPath;
  connectionOptions.method = msg.requestMethod;

  console.log(connectionOptions);

  var result = {
    "rabbitReplyQueue" : deliveryInfo.replyTo,
    "correlationId" : deliveryInfo.correlationId
  };
 
  requestReady.emit('finished',result,connectionOptions);
};

requestReady.on('finished',function(connectionOptions,result){
  var req = https.request(connectionOptions, function(res) {
  var job = {
    "responseStatus": res.statusCode,
    "responseHeaders": res.headers,
    "responsePayload": ""
  };
  if (base64Encoded === true){
    res.setEncoding('binary');
  }

  res.on('data', function(chunk) {
    console.log("Loading data chunk..");
    job.responsePayload += chunk;
  });

  res.on('end',function() {
     if (base64Encoded === true){
    job.responsePayload = new Buffer(job.responsePayload, 'binary').toString('base64');
    }
    console.log("We are publishing..");
    connection.publish(
      result.rabbitReplyQueue,
      job,
      {
      "correlationId": result.correlationId,
      "contentType":"application/json",
      "headers": {"__TypeId__": "com.sample.amqp.ResponseDelegate"}
      }
      ); 
    });
  });

  req.end();

  req.on('error', function(e) {
  console.error("houston we have a problem\n" + e);
  });
});


