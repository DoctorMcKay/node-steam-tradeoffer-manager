"use strict";

require('@doctormckay/stats-reporter').setup(require('../package.json'));

const AppDirectory = require('appdirectory');
const Async = require('async');
const FileManager = require('file-manager');
const StdLib = require('@doctormckay/stdlib');
const SteamCommunity = require('steamcommunity');
const Zlib = require('zlib');

const Helpers = require('./helpers.js');

module.exports = TradeOfferManager;

const EConfirmationMethod = TradeOfferManager.EConfirmationMethod = require('../resources/EConfirmationMethod.js');
const EOfferFilter = TradeOfferManager.EOfferFilter = require('../resources/EOfferFilter.js');
const EResult = TradeOfferManager.EResult = require('../resources/EResult.js');
const ETradeOfferState = TradeOfferManager.ETradeOfferState = require('../resources/ETradeOfferState.js');
const ETradeSessionStatus = TradeOfferManager.ETradeSessionStatus = require('../resources/ETradeSessionStatus.js');
const ETradeStatus = TradeOfferManager.ETradeStatus = require('../resources/ETradeStatus.js');
const SteamID = TradeOfferManager.SteamID = require('steamid');

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

	if (options.globalAssetCache) {
		global._steamTradeOfferManagerAssetCache = global._steamTradeOfferManagerAssetCache || new StdLib.DataStructures.LeastUsedCache(500, 120000);
		this._assetCache = global._steamTradeOfferManagerAssetCache;
	} else {
		this._assetCache = new StdLib.DataStructures.LeastUsedCache(500, 120000);
	}

	// Set up disk persistence
	if (!options.dataDirectory && options.dataDirectory !== null) {
		if (process.env.OPENSHIFT_DATA_DIR) {
			options.dataDirectory = process.env.OPENSHIFT_DATA_DIR + "/node-steam-tradeoffer-manager";
		} else {
			options.dataDirectory = (new AppDirectory({
				"appName": "node-steam-tradeoffer-manager",
				"appAuthor": "doctormckay"
			})).userData();
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

/**
 * Set your cookies so that the TradeOfferManager can talk to Steam under your account.
 * @param {string[]} cookies - An array of cookies, each cookie in "name=value" format
 * @param {string} [familyViewPin] - If your account is locked with Family View, provide the PIN here
 * @param {function} [callback]
 * @returns {Promise}
 */
TradeOfferManager.prototype.setCookies = function(cookies, familyViewPin, callback) {
	return StdLib.Promises.callbackPromise([], callback, true, (accept, reject) => {
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
					this.pollData = JSON.parse(files[filename].toString('utf8'));
				}
			});
		}

		const checkDone = (err) => {
			if (!err) {
				if (this._languageName) {
					this._community.setCookies(['Steam_Language=' + this._languageName]);
				}

				clearTimeout(this._pollTimer);
				this.doPoll();
			}

			err ? reject(err) : accept();
		};

		if (familyViewPin) {
			this.parentalUnlock(familyViewPin, (err) => {
				if (err) {
					reject(err);
				} else {
					this._checkApiKey(checkDone);
				}
			});
		} else {
			this._checkApiKey(checkDone);
		}
	});
};

/**
 * Shut down the TradeOfferManager. Clear its cookies and API key and stop polling.
 */
TradeOfferManager.prototype.shutdown = function() {
	clearTimeout(this._pollTimer);
	this._community = new SteamCommunity();
	this._steam = null;
	this.apiKey = null;
};

/**
 * If the account has Family View, unlock it with the PIN.
 * @param {string} pin
 * @param {function} [callback]
 * @returns {Promise}
 */
TradeOfferManager.prototype.parentalUnlock = function(pin, callback) {
	return StdLib.Promises.callbackPromise([], callback, true, (accept, reject) => {
		this._community.parentalUnlock(pin, (err) => {
			err ? reject(err) : accept();
		});
	});
};

/**
 * Make sure we have an API key, and if we don't, get one.
 * @param {function} callback
 * @private
 */
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

/**
 * Write a file to disk.
 * @param {string} filename
 * @param {Buffer|string} content
 * @private
 */
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

/**
 * Get some files from disk.
 * @param {string[]} filenames
 * @param {function} callback
 * @private
 */
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
 * @param {function} [callback]
 * @returns {Promise}
 */
TradeOfferManager.prototype.getInventoryContents = function(appid, contextid, tradableOnly, callback) {
	return this.getUserInventoryContents(this.steamID, appid, contextid, tradableOnly, callback);
};

/**
 * Get the contents of a user's specific inventory context.
 * @param {SteamID|string} sid - The user's SteamID as a SteamID object or a string which can parse into one
 * @param {int} appid - The Steam application ID of the game for which you want an inventory
 * @param {int} contextid - The ID of the "context" within the game you want to retrieve
 * @param {boolean} tradableOnly - true to get only tradable items and currencies
 * @param {function} [callback]
 * @returns {Promise}
 */
TradeOfferManager.prototype.getUserInventoryContents = function(sid, appid, contextid, tradableOnly, callback) {
	return StdLib.Promises.callbackPromise(['inventory', 'currencies'], callback, false, (accept, reject) => {
		this._community.getUserInventoryContents(sid, appid, contextid, tradableOnly, this._languageName || "english", (err, inventory, currencies) => {
			if (err) {
				reject(err);
			} else {
				accept({inventory, currencies});
			}
		});
	});
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
 * @param {function} [callback]
 * @returns {Promise}
 */
TradeOfferManager.prototype.getOfferToken = function(callback) {
	return StdLib.Promises.callbackPromise(['token'], callback, false, (accept, reject) => {
		this._community.getTradeURL((err, url, token) => {
			err ? reject(err) : accept({token});
		});
	});
};

/**
 * Get a list of trade offers that contain some input items.
 * @param {object[]|object} items - One object or an array of objects, where each object contains appid+contextid+(assetid|id) properties
 * @param {boolean} [includeInactive=false] If true, also include trade offers that are not Active
 * @param {function} [callback]
 * @returns {Promise}
 */
TradeOfferManager.prototype.getOffersContainingItems = function(items, includeInactive, callback) {
	return StdLib.Promises.callbackPromise(['sent', 'received'], callback, false, (accept, reject) => {
		if (typeof includeInactive === 'function') {
			callback = includeInactive;
			includeInactive = false;
		}

		includeInactive = includeInactive || false;

		if (typeof items.length === 'undefined') {
			// not an array
			items = [items];
		}

		this.getOffers(includeInactive ? EOfferFilter.All : EOfferFilter.ActiveOnly, (err, sent, received) => {
			err ? reject(err) : accept({"sent": sent.filter(filterFunc), "received": received.filter(filterFunc)});
		});

		function filterFunc(offer) {
			return items.some(item => offer.containsItem(item));
		}
	});
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
 * @param {function} [callback]
 * @returns {Promise}
 */
TradeOfferManager.prototype.getOffer = function(id, callback) {
	return StdLib.Promises.callbackPromise(['offer'], callback, false, (accept, reject) => {
		this._apiCall('GET', 'GetTradeOffer', 1, {"tradeofferid": id}, (err, body) => {
			if (err) {
				reject(err);
				return;
			}

			if (!body.response) {
				reject(new Error("Malformed API response"));
				return;
			}

			if (!body.response.offer) {
				reject(new Error("No matching offer found"));
				return;
			}

			// Make sure the response is well-formed
			if (Helpers.offerMalformed(body.response.offer)) {
				reject(new Error("Data temporarily unavailable"));
				return;
			}

			this._digestDescriptions(body.response.descriptions);
			Helpers.checkNeededDescriptions(this, [body.response.offer], (err) => {
				err ? reject(err) : accept({"offer": Helpers.createOfferFromData(this, body.response.offer)});
			});
		});
	});
};

/**
 * Get a list of trade offers either sent to you or by you
 * @param {int} filter
 * @param {Date} [historicalCutoff] - Pass a Date object in the past along with ActiveOnly to also get offers that were updated since this time
 * @param {function} [callback]
 */
TradeOfferManager.prototype.getOffers = function(filter, historicalCutoff, callback) {
	return StdLib.Promises.callbackPromise(['sent', 'received'], callback, false, (accept, reject) => {
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
			"time_historical_cutoff": Math.floor(historicalCutoff.getTime() / 1000)
		};

		this._apiCall('GET', 'GetTradeOffers', 1, options, (err, body) => {
			if (err) {
				reject(err);
				return;
			}

			if (!body.response) {
				reject(new Error("Malformed API response"));
				return;
			}

			// Make sure at least some offers are well-formed. Apparently some offers can be empty just forever. Because Steam.
			var allOffers = (body.response.trade_offers_sent || []).concat(body.response.trade_offers_received || []);
			if (allOffers.length > 0 && (allOffers.every(Helpers.offerMalformed) || allOffers.some(Helpers.offerSuperMalformed))) {
				reject(new Error("Data temporarily unavailable"));
				return;
			}

			//manager._digestDescriptions(body.response.descriptions);

			// Let's check the asset cache and see if we have descriptions that match these items.
			// If the necessary descriptions aren't in the asset cache, this will request them from the WebAPI and store
			// them for future use.
			Helpers.checkNeededDescriptions(this, (body.response.trade_offers_sent || []).concat(body.response.trade_offers_received || []), (err) => {
				if (err) {
					reject(new Error("Descriptions: " + err.message));
					return;
				}

				var sent = (body.response.trade_offers_sent || []).map(data => Helpers.createOfferFromData(this, data));
				var received = (body.response.trade_offers_received || []).map(data => Helpers.createOfferFromData(this, data));

				accept({sent, received});
				this.emit('offerList', filter, sent, received);
			});
		});
	});
};

require('./classes/TradeSession.js');
