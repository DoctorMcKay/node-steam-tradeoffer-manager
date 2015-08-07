var TradeOfferManager = require('./index.js');
var Protobuf = require('protobufjs');

var EResult = require('../resources/EResult.js');

var builder = Protobuf.newBuilder();
Protobuf.loadProtoFile(__dirname + '/../resources/tradeoffers.proto', builder);
var Protos = builder.build();

TradeOfferManager.prototype._apiCall = function(httpMethod, method, version, input, callback) {
	var iface = 'IEconService';
	if(typeof method === 'object') {
		iface = method.iface;
		method = method.method;
	}
	
	var options = {
		"uri": "https://api.steampowered.com/" + iface + "/" + method + "/v" + version + "/",
		"json": true,
		"method": httpMethod
	};

	if(iface == 'IEconService') {
		if(method == 'GetTradeOffers') {
			// Use protobuf
			input = {
				"input_protobuf_encoded": (new Protos.GetTradeOffers_Request(input)).toBuffer().toString('base64'),
				"format": "protobuf_raw"
			};

			options.json = false;
			options.encoding = null;
		} else if(method == 'GetTradeOffer') {
			input = {
				"input_protobuf_encoded": (new Protos.GetTradeOffer_Request(input)).toBuffer().toString('base64'),
				"format": "protobuf_raw"
			};

			options.json = false;
			options.encoding = null;
		}
	}
	
	input = input || {};
	input.key = this.apiKey;
	options[httpMethod == 'GET' ? 'qs' : 'form'] = input;
	
	this._request(options, function(err, response, body) {
		if(err || response.statusCode != 200) {
			callback(err || new Error("HTTP error " + response.statusCode));
			return;
		}
		
		var eresult = response.headers['x-eresult'];
		if(typeof eresult !== 'undefined' && eresult != 1) {
			var error = new Error(EResult.getName(eresult));
			error.eresult = eresult;
			callback(error);
			return;
		}

		if(iface == 'IEconService') {
			if(method == 'GetTradeOffers') {
				try {
					body = {"response": Protos.GetTradeOffers_Response.decode(body)};
				} catch(e) {
					callback(new Error("Invalid API response"));
					return;
				}
			} else if(method == 'GetTradeOffer') {
				try {
					body = {"response": Protos.GetTradeOffer_Response.decode(body)};
				} catch(e) {
					callback(new Error("Invalid API response"));
					return;
				}
			}
		}
		
		if(!body || typeof body != 'object') {
			callback(new Error("Invalid API response"));
			return;
		}
		
		callback(null, body);
	});
};
