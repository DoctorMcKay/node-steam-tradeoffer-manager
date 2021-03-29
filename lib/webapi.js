"use strict";

const EResult = require('../resources/EResult.js');
const TradeOfferManager = require('./index.js');

/**
 * Make an API call.
 * @param {string} httpMethod
 * @param {string|{iface: string, method: string}} method
 * @param {int} version
 * @param {object} [input]
 * @returns {Promise<Object>}
 * @private
 */
TradeOfferManager.prototype._apiCall = function(httpMethod, method, version, input) {
	return new Promise((resolve, reject) => {
		if (!this.apiKey) {
			return reject(new Error("No API-Key set (yet)"));
		}

		let iface = 'IEconService';
		if (typeof method === 'object') {
			iface = method.iface;
			method = method.method;
		}

		let options = {
			uri: `https://api.steampowered.com/${iface}/${method}/v${version}/`,
			json: true,
			method: httpMethod,
			gzip: true
		};

		input = input || {};
		input.key = this.apiKey;
		options[httpMethod == 'GET' ? 'qs' : 'form'] = input;

		this._community.httpRequest(options, (err, response, body) => {
			if (err) {
				err.body = body;
				return reject(err);
			}

			let error;

			if (response.statusCode != 200) {
				error = new Error('HTTP error ' + response.statusCode);
				error.body = body;
				return reject(error);
			}

			let eresult = response.headers['x-eresult'];
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
				return reject(error);
			}

			if (!body || typeof body != 'object') {
				error = new Error('Invalid API response');
				error.body = body;
				return reject(error);
			}

			resolve(body);
		}, "tradeoffermanager");
	});
};
