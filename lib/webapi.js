var TradeOfferManager = require('./index.js');

var EResult = require('../resources/EResult.js');

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
	
	input = input || {};
	input.key = this.apiKey;
	options[httpMethod == 'GET' ? 'qs' : 'form'] = input;
	
	this._request(options, function(err, response, body) {
		if(err || response.statusCode != 200) {
			return callback(err || new Error("HTTP error " + response.statusCode));
		}
		
		var eresult = response.headers['x-eresult'];
		if(typeof eresult !== 'undefined' && eresult != 1) {
			return callback(new Error(EResult[eresult]));
		}
		
		if(!body || typeof body != 'object') {
			return callback(new Error("Invalid API response"));
		}
		
		return callback(null, body);
	});
};
