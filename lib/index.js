"use strict";

const Async = require('async');
const FileManager = require('file-manager');
const {LeastUsedCache} = require('@doctormckay/stdlib').DataStructures;
const {appDataDirectory} = require('@doctormckay/stdlib').OS;
const SteamCommunity = require('steamcommunity');
const Zlib = require('zlib');

const Helpers = require('./helpers.js');

module.exports = TradeOfferManager;

const SteamID = TradeOfferManager.SteamID = require('steamid');
const ETradeOfferState = TradeOfferManager.ETradeOfferState = require('../resources/ETradeOfferState.js');
const EOfferFilter = TradeOfferManager.EOfferFilter = require('../resources/EOfferFilter.js');
const EResult = TradeOfferManager.EResult = require('../resources/EResult.js');
const EConfirmationMethod = TradeOfferManager.EConfirmationMethod = require('../resources/EConfirmationMethod.js');
const ETradeStatus = TradeOfferManager.ETradeStatus = require('../resources/ETradeStatus.js');

const TradeOffer = require('./classes/TradeOffer.js');

require('util').inherits(TradeOfferManager, require('events').EventEmitter);

function TradeOfferManager(options) {
	options = options || {};

	this._steam = options.steam;
	this._domain = options.domain || 'localhost';
	this._language = options.language;

	if (this._domain == 'doctormckay.com' && !process.env.MCKAY_BOX) {
		throw new Error("Please fill in your own domain. I'm pretty sure you don't own doctormckay.com.");
	}

	this._community = options.community || new SteamCommunity();
	this._pollTimer = null;
	this._lastPoll = 0;
	this._lastPollFullUpdate = 0;
	this._pendingOfferSendResponses = 0;
	this._dataGzip = options.gzipData;

	var assetCacheSize = options.assetCacheMaxItems || 500;
	var assetCacheGcInterval = options.assetCacheGcInterval || 120000; // 2 minutes

	if (options.globalAssetCache) {
		global._steamTradeOfferManagerAssetCache = global._steamTradeOfferManagerAssetCache || new LeastUsedCache(assetCacheSize, assetCacheGcInterval);
		this._assetCache = global._steamTradeOfferManagerAssetCache;
	} else {
		this._assetCache = new LeastUsedCache(assetCacheSize, assetCacheGcInterval);
	}

	// Set up disk persistence
	if (!options.dataDirectory && options.dataDirectory !== null) {
		if (process.env.OPENSHIFT_DATA_DIR) {
			options.dataDirectory = process.env.OPENSHIFT_DATA_DIR + "/node-steam-tradeoffer-manager";
		} else {
			options.dataDirectory = appDataDirectory({
				appName: 'node-steam-tradeoffer-manager',
				appAuthor: 'doctormckay'
			});
		}
	}

	if (options.dataDirectory) {
		this.storage = new FileManager(options.dataDirectory);
	}

	this.pollInterval = options.pollInterval || 30000;
	this.cancelTime = options.cancelTime;
	this.pendingCancelTime = options.pendingCancelTime;
	this.cancelOfferCount = options.cancelOfferCount;
	this.cancelOfferCountMinAge = options.cancelOfferCountMinAge || 0;

	this.pollData = options.pollData || {};
	this.apiKey = null;
	this.steamID = null;

	if (this._language) {
		if (this._language == 'szh') {
			this._language = 'zh';
			this._languageName = 'schinese';
		} else if (this._language == 'tzh') {
			this._language = 'zh';
			this._languageName = 'tchinese';
		} else if (this._language == 'br') {
			this._language = 'pt-BR';
			this._languageName = 'brazilian';
		} else {
			var lang = require('languages').getLanguageInfo(this._language);
			if (!lang.name) {
				this._language = null;
				this._languageName = null;
			} else {
				this._languageName = lang.name.toLowerCase();
			}
		}
	}

	if (this._steam) {
		this._steam.on('tradeOffers', (count) => {
			this.doPoll();
		});

		// This is an instance of https://www.npmjs.com/package/steam-user, and newItems is emitted when new items are announced
		this._steam.on('newItems', (count) => {
			this.doPoll();
		});
	}

	if (options.savePollData) {
		this._getPollDataFromDisk = true;
		this.on('pollData', (pollData) => {
			if (this.steamID) {
				this._persistToDisk('polldata_' + this.steamID + '.json', JSON.stringify(pollData));
			}
		});
	}
}

TradeOfferManager.prototype.setCookies = function(cookies, familyViewPin, callback) {
	if (typeof familyViewPin === 'function') {
		callback = familyViewPin;
		familyViewPin = null;
	}

	this._community.setCookies(cookies);
	this.steamID = this._community.steamID;

	if (this._getPollDataFromDisk) {
		delete this._getPollDataFromDisk;
		var filename = 'polldata_' + this.steamID + '.json';
		this._getFromDisk([filename], (err, files) => {
			if (files[filename]) {
				try {
					this.pollData = JSON.parse(files[filename].toString('utf8'));
				} catch (ex) {
					this.emit('debug', 'Error parsing poll data from disk: ' + ex.message);
				}
			}
		});
	}

	var checkDone = (err) => {
		if (!err) {
			if (this._languageName) {
				this._community.setCookies(['Steam_Language=' + this._languageName]);
			}

			clearTimeout(this._pollTimer);
			this.doPoll();
		}

		if (callback) {
			callback(err);
		}
	};

	if (familyViewPin) {
		this.parentalUnlock(familyViewPin, (err) => {
			if (err) {
				if (callback) {
					callback(err);
				}
			} else {
				this._checkApiKey(checkDone);
			}
		});
	} else {
		this._checkApiKey(checkDone);
	}
};

TradeOfferManager.prototype.shutdown = function() {
	clearTimeout(this._pollTimer);
	this._community = new SteamCommunity();
	this._steam = null;
	this.apiKey = null;
};

TradeOfferManager.prototype.parentalUnlock = function(pin, callback) {
	this._community.parentalUnlock(pin, (err) => {
		if (callback) {
			callback(err || null);
		}
	});
};

TradeOfferManager.prototype._checkApiKey = function(callback) {
	if (this.apiKey) {
		if (callback) {
			callback();
		}

		return;
	}

	this._community.getWebApiKey(this._domain, (err, key) => {
		if (err) {
			callback(err);
			return;
		}

		this.apiKey = key;
		callback();
	});
};

TradeOfferManager.prototype._persistToDisk = function(filename, content) {
	if (!this.storage) {
		return;
	}

	if (typeof content === 'string') {
		content = Buffer.from(content, 'utf8');
	}

	if (this._dataGzip) {
		Zlib.gzip(content, (err, data) => {
			if (err) {
				this.emit('debug', `Cannot gzip ${filename}: ${err.message}`);
			} else {
				this.storage.writeFile(filename + '.gz', data, (err) => {
					if (err) {
						this.emit('debug', `Cannot write ${filename}.gz: ${err.message}`);
					}
				});
			}
		});
	} else {
		this.storage.writeFile(filename, content, (err) => {
			if (err) {
				this.emit('debug', `Cannot write ${filename}: ${err.message}`);
			}
		});
	}
};

TradeOfferManager.prototype._getFromDisk = function(filenames, callback) {
	if (!this.storage) {
		callback(null, {});
		return;
	}

	if (this._dataGzip) {
		filenames = filenames.map(name => name + '.gz');
	}

	this.storage.readFiles(filenames, (err, results) => {
		var files = {};
		results.forEach((file) => {
			if (file.contents) {
				files[file.filename] = file.contents;
			}
		});

		if (this._dataGzip) {
			Async.mapValues(files, (content, filename, callback) => {
				Zlib.gunzip(content, (err, data) => {
					if (err) {
						callback(null, null);
					} else {
						callback(null, data);
					}
				});
			}, (err, files) => {
				var renamed = {};
				for (var i in files) {
					if (files.hasOwnProperty(i)) {
						renamed[i.replace(/\.gz$/, '')] = files[i];
					}
				}

				callback(null, renamed);
			});
		} else {
			callback(null, files);
		}
	});
};

/**
 * Get the contents of your own specific inventory context.
 * @param {int} appid - The Steam application ID of the game for which you want an inventory
 * @param {int} contextid - The ID of the "context" within the game you want to retrieve
 * @param {boolean} tradableOnly - true to get only tradable items and currencies
 * @param callback
 */
TradeOfferManager.prototype.getInventoryContents = function(appid, contextid, tradableOnly, callback) {
	// are we logged in?
	if (!this.steamID) {
		callback(new Error("Not Logged In"));
		return;
	}

	this.getUserInventoryContents(this.steamID, appid, contextid, tradableOnly, callback);
};

/**
 * Get the contents of a user's specific inventory context.
 * @param {SteamID|string} sid - The user's SteamID as a SteamID object or a string which can parse into one
 * @param {int} appid - The Steam application ID of the game for which you want an inventory
 * @param {int} contextid - The ID of the "context" within the game you want to retrieve
 * @param {boolean} tradableOnly - true to get only tradable items and currencies
 * @param callback
 */
TradeOfferManager.prototype.getUserInventoryContents = function(sid, appid, contextid, tradableOnly, callback) {
	this._community.getUserInventoryContents(sid, appid, contextid, tradableOnly, this._languageName || "english", callback);
};

/**
 * Get the contents of your own specific inventory context.
 * @deprecated Use getInventoryContents instead
 * @param {int} appid - The Steam application ID of the game for which you want an inventory
 * @param {int} contextid - The ID of the "context" within the game you want to retrieve
 * @param {boolean} tradableOnly - true to get only tradable items and currencies
 * @param callback
 */
TradeOfferManager.prototype.loadInventory = function(appid, contextid, tradableOnly, callback) {
	// are we logged in?
	if (!this.steamID) {
		callback(new Error("Not Logged In"));
		return;
	}

	this.loadUserInventory(this.steamID, appid, contextid, tradableOnly, callback);
};

/**
 * Get the contents of a user's specific inventory context.
 * @deprecated Use getUserInventoryContents instead
 * @param {SteamID|string} sid - The user's SteamID as a SteamID object or a string which can parse into one
 * @param {int} appid - The Steam application ID of the game for which you want an inventory
 * @param {int} contextid - The ID of the "context" within the game you want to retrieve
 * @param {boolean} tradableOnly - true to get only tradable items and currencies
 * @param callback
 */
TradeOfferManager.prototype.loadUserInventory = function(sid, appid, contextid, tradableOnly, callback) {
	this._community.getUserInventory(sid, appid, contextid, tradableOnly, callback);
};

/**
 * Get the token parameter from your account's Trade URL
 * @param {function} callback
 */
TradeOfferManager.prototype.getOfferToken = function(callback) {
	this._community.getTradeURL((err, url, token) => {
		if (err) {
			callback(err);
			return;
		}

		callback(null, token);
	});
};

TradeOfferManager.prototype.getOffersContainingItems = function(items, includeInactive, callback) {
	if (typeof includeInactive === 'function') {
		callback = includeInactive;
		includeInactive = false;
	}

	if (typeof items.length === 'undefined') {
		// not an array
		items = [items];
	}

	this.getOffers(includeInactive ? EOfferFilter.All : EOfferFilter.ActiveOnly, (err, sent, received) => {
		if (err) {
			callback(err);
			return;
		}

		callback(null, sent.filter(filterFunc), received.filter(filterFunc));
	});

	function filterFunc(offer) {
		return items.some(item => offer.containsItem(item));
	}
};

/**
 * Create a new TradeOffer object.
 * @param {string|SteamID} partner - Their full Trade URL or their SteamID (as a SteamID object or a string that can parse into one)
 * @param {string} [token] - Their trade token, if you aren't friends with them
 * @returns {TradeOffer}
 */
TradeOfferManager.prototype.createOffer = function(partner, token) {
	if (typeof partner === 'string' && partner.match(/^https?:\/\//)) {
		// It's a trade URL I guess
		var url = require('url').parse(partner, true);
		if (!url.query.partner) {
			throw new Error("Invalid trade URL");
		}

		partner = SteamID.fromIndividualAccountID(url.query.partner);
		token = url.query.token;
	}

	var offer = new TradeOffer(this, partner, token);
	offer.isOurOffer = true;
	offer.fromRealTimeTrade = false;
	return offer;
};

require('./webapi.js');
require('./assets.js');
require('./polling.js');

/**
 * Get a trade offer that is already sent (either by you or to you)
 * @param {int|string} id - The offer's numeric ID
 * @param {function} callback
 */
TradeOfferManager.prototype.getOffer = function(id, callback) {
	this._apiCall('GET', 'GetTradeOffer', 1, {"tradeofferid": id}, (err, body) => {
		if (err) {
			callback(err);
			return;
		}

		if (!body.response) {
			callback(new Error("Malformed API response"));
			return;
		}

		if (!body.response.offer) {
			callback(new Error("No matching offer found"));
			return;
		}

		// Make sure the response is well-formed
		if (Helpers.offerMalformed(body.response.offer)) {
			callback(new Error("Data temporarily unavailable"));
			return;
		}

		this._digestDescriptions(body.response.descriptions);
		Helpers.checkNeededDescriptions(this, [body.response.offer], (err) => {
			if (err) {
				callback(err);
				return;
			}

			callback(null, Helpers.createOfferFromData(this, body.response.offer));
		});
	});
};

/**
 * Get a list of trade offers either sent to you or by you
 * @param {int} filter
 * @param {Date} [historicalCutoff] - Pass a Date object in the past along with ActiveOnly to also get offers that were updated since this time
 * @param {function} callback
 */
TradeOfferManager.prototype.getOffers = function(filter, historicalCutoff, callback) {
	if ([EOfferFilter.ActiveOnly, EOfferFilter.HistoricalOnly, EOfferFilter.All].indexOf(filter) == -1) {
		throw new Error('Unexpected value "' + filter + '" for "filter" parameter. Expected a value from the EOfferFilter enum.');
	}

	if (typeof historicalCutoff === 'function') {
		callback = historicalCutoff;
		historicalCutoff = new Date(Date.now() + 31536000000);
	} else if (!historicalCutoff) {
		historicalCutoff = new Date(Date.now() + 31536000000);
	}

	// Currently the GetTradeOffers API doesn't include app_data, so we need to get descriptions from the WebAPI

	var options = {
		"get_sent_offers": 1,
		"get_received_offers": 1,
		"get_descriptions": 0,
		"language": this._language,
		"active_only": (filter == EOfferFilter.ActiveOnly) ? 1 : 0,
		"historical_only": (filter == EOfferFilter.HistoricalOnly) ? 1 : 0,
		"time_historical_cutoff": Math.floor(historicalCutoff.getTime() / 1000),
		"cursor": 0
	};

	var sentOffers = [];
	var receivedOffers = [];

	var request = () => {
		this._apiCall('GET', 'GetTradeOffers', 1, options, (err, body) => {
			if (err) {
				callback(err);
				return;
			}

			if (!body.response) {
				callback(new Error("Malformed API response"));
				return;
			}

			// Make sure at least some offers are well-formed. Apparently some offers can be empty just forever. Because Steam.
			var allOffers = (body.response.trade_offers_sent || []).concat(body.response.trade_offers_received || []);
			if (allOffers.length > 0 && (allOffers.every(Helpers.offerMalformed) || allOffers.some(Helpers.offerSuperMalformed))) {
				callback(new Error("Data temporarily unavailable"));
				return;
			}

			sentOffers = sentOffers.concat(body.response.trade_offers_sent || []);
			receivedOffers = receivedOffers.concat(body.response.trade_offers_received || []);

			options.cursor = body.response.next_cursor || 0;
			if (typeof options.cursor == 'number' && options.cursor != 0) {
				this.emit('debug', 'GetTradeOffers with cursor ' + options.cursor);
				request();
			} else {
				finish();
			}
		});
	};

	var finish = () => {
		//manager._digestDescriptions(body.response.descriptions);

		// Let's check the asset cache and see if we have descriptions that match these items.
		// If the necessary descriptions aren't in the asset cache, this will request them from the WebAPI and store
		// them for future use.
		Helpers.checkNeededDescriptions(this, sentOffers.concat(receivedOffers), (err) => {
			if (err) {
				callback(new Error("Descriptions: " + err.message));
				return;
			}

			var sent = sentOffers.map(data => Helpers.createOfferFromData(this, data));
			var received = receivedOffers.map(data => Helpers.createOfferFromData(this, data));

			callback(null, sent, received);
			this.emit('offerList', filter, sent, received);
		});
	};

	request();
};
