"use strict";

const TradeOfferManager = require('./index.js');

const EResult = require('../resources/EResult.js');

TradeOfferManager.prototype._apiCall = function(httpMethod, method, version, input, callback) {
	if (!this.apiKey && !this.accessToken) {
		callback(new Error('API key or access token is not set yet. Call setCookies() first.'));
		return;
	}

	var iface = 'IEconService';
	if (typeof method === 'object') {
		iface = method.iface;
		method = method.method;
	}

	var options = {
		"uri": `https://api.steampowered.com/${iface}/${method}/v${version}/`,
		"json": true,
		"method": httpMethod,
		"gzip": true
	};

	input = input || {};

	// We shouldn't strictly need to check useAccessToken here because we wouldn't have an API key anyway, but some
	// people insist on manually assigning their API key despite the docs telling you not to do that.
	if (this.apiKey && !this.useAccessToken) {
		input.key = this.apiKey;
	} else {
		input.access_token = this.accessToken;
	}

	options[httpMethod == 'GET' ? 'qs' : 'form'] = input;

	this._community.httpRequest(options, (err, response, body) => {
		var error = err;

		if (response && response.statusCode != 200 && !error) {
			error = new Error('HTTP error ' + response.statusCode);
		}

		if (error) {
			error.body = body;

			if (response && typeof response.body === 'string' && response.body.indexOf('Access is denied') >= 0) {
				this._notifySessionExpired(error);
			}

			callback(error);
			return;
		}

		var eresult = response.headers['x-eresult'];
		if (eresult == 2 && body && (Object.keys(body).length > 1 || (body.response && Object.keys(body.response).length > 0))) {
			// Steam has been known to send fake Fail (2) responses when it actually worked, because of course it has
			// If we get a 2 but body is there and either body has more than one key or body.response exists and it has content,
			// ignore the 2
			eresult = 1;
		}

		if (typeof eresult !== 'undefined' && eresult != 1) {
			error = new Error(EResult[eresult] || eresult);
			error.eresult = eresult;
			error.body = body;
			callback(error);
			return;
		}

		if (!body || typeof body != 'object') {
			error = new Error('Invalid API response');
			error.body = body;
			callback(error);
			return;
		}

		callback(null, body);
	}, "tradeoffermanager");
};
