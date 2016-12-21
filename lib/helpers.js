"use strict";

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
				
				switch(error.eresult) {
					case 2:
						// This is occasionally returned when something unexpected goes wrong when sending or accepting a trade offer.
						error.cause = 'Failure';
					break;
					case 11:
						// This trade offer is in an invalid state, and cannot be acted upon. Usually you'll need to send a new trade offer.
						error.cause = 'InvalidOfferState';
					break;
					case 15:
						// You can't send or accept this trade offer because either you can't trade with the other user, or one of the parties in this trade can't send/receive one of the items in the trade.
						// Possible causes:
						//	  a) You aren't friends with the other user and you didn't provide a trade token.
						//	  b) The trade token was wrong.
						//	  c) You are trying to send or receive an item for a game in which you or the other user can't trade (e.g. due to a VAC ban).
						//	  d) You are trying to send an item and the other user's inventory is full for that game.
						error.cause = 'AccessDenied';
					break;
					case 16:
						// The Steam Community web server did not receive a timely reply from the trade offers server while sending/accepting this trade offer. It is possible (and not unlikely) that the operation actually succeeded.
						error.cause = 'TimedOut';
					break;
					case 20:
						// As the name suggests, the trade offers service is currently unavailable.
						error.cause = 'ServiceUnavailable';
					break;
					case 25:
						// Sending this trade offer would put you over your limit. You are limited to 5 Active offers (including those requiring confirmation, but excluding those in escrow) to a single recipient, or 30 Active offers total.
						// If you are accepting a trade offer, then your inventory for a particular game may be full.
						error.cause = 'OfferLimitExceeded';
					break;
					case 26:
						// This response code suggests that one or more of the items in this trade offer does not exist in the inventory from which it was requested.
						error.cause = 'InvalidItems';
					break;
					case 28:
						// When accepting a trade offer, this response code suggests that it has already been accepted.
						error.cause = 'AlreadyActedOn';
					break;
				}
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

			callback(error);

			return error;
		} else {
			callback(error);
			return error;
		}
	}

	return null;
};
