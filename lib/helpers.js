"use strict";

var EResult = require('../resources/EResult.js');

exports.itemEquals = function(a, b) {
	return a.appid == b.appid && a.contextid == b.contextid && (a.assetid || a.id) == (b.assetid || b.id);
};

exports.makeAnError = function(error, callback, body) {
	if (callback) {
		if (body && body.strError) {
			error = new Error(body.strError);

			var match = body.strError.match(/\((\d+)\)$/);
			if (match) {
				error.eresult = parseInt(match[1], 10);
			}

			if (body.strError.match(/You cannot trade with .* because they have a trade ban./)) {
				error.cause = 'TradeBan';
			}

			if (body.strError.match(/You have logged in from a new device/)) {
				error.cause = 'NewDevice';
			}

			if (body.strError.match(/is not available to trade\. More information will be shown to/)) {
				error.cause = 'TargetCannotTrade';
			}

			if (body.strError.match(/sent too many trade offers/)) {
				error.cause = 'OfferLimitExceeded';
				error.eresult = EResult.LimitExceeded;
			}

			if (body.strError.match(/unable to contact the game's item server/)) {
				error.cause = 'ItemServerUnavailable';
				error.eresult = EResult.ServiceUnavailable;
			}

			callback(error);

			return error;
		} else {
			callback(error);
			return error;
		}
	}

	return null;
};
