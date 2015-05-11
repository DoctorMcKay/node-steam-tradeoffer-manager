var TradeOfferManager = require('./index.js');

TradeOfferManager.prototype._apiCall = function(httpMethod, method, version, input, callback) {
	var options = {
		"uri": "https://api.steampowered.com/IEconService/" + method + "/v" + version + "/",
		"json": true,
		"method": httpMethod
	};
	
	options[httpMethod == 'GET' ? 'qs' : 'form'] = {
		"key": this.apiKey,
		"input_json": JSON.stringify(input || {})
	};
	
	this._request(options, function(err, response, body) {
		if(err || response.statusCode != 200) {
			return callback(err || new Error("HTTP error " + response.statusCode));
		}
		
		if(!body || typeof body != 'object') {
			return callback(new Error("Invalid API response"));
		}
		
		callback(null, body);
	});
};
