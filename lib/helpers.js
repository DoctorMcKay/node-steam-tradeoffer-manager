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

			if (body.strError.match(/they have a trade ban/)) {
				error.cause = 'TradeBan';
			}

			if (body.strError.match(/logged in from a new device/)) {
				error.cause = 'NewDevice';
			}

			if (body.strError.match(/not available to trade/)) {
				error.cause = 'TargetCannotTrade';
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
