var TradeOfferManager = require('./index.js');

var EResult = require('../resources/EResult.js');

TradeOfferManager.prototype._apiCall = function(httpMethod, method, version, input, callback) {
	if(!this.apiKey) {
		callback(new Error("No API-Key set (yet)"));
		return;
	}

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

		if(!body || typeof body != 'object') {
			callback(new Error("Invalid API response"));
			return;
		}

		callback(null, body);
	});
};
