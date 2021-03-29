"use strict";

const AppDirectory = require('appdirectory');
const EventEmitter = require('events').EventEmitter;
const FileManager = require('file-manager');
const StdLib = require('@doctormckay/stdlib');
const SteamCommunity = require('steamcommunity');
const Util = require('util');
const Zlib = require('zlib');

const Helpers = require('./helpers.js');

module.exports = TradeOfferManager;

const EConfirmationMethod = TradeOfferManager.EConfirmationMethod = require('../resources/EConfirmationMethod.js');
const EOfferFilter = TradeOfferManager.EOfferFilter = require('../resources/EOfferFilter.js');
const EResult = TradeOfferManager.EResult = require('../resources/EResult.js');
const ETradeOfferState = TradeOfferManager.ETradeOfferState = require('../resources/ETradeOfferState.js');
//const ETradeSessionStatus = TradeOfferManager.ETradeSessionStatus = require('../resources/ETradeSessionStatus.js');
const ETradeStatus = TradeOfferManager.ETradeStatus = require('../resources/ETradeStatus.js');
const SteamID = TradeOfferManager.SteamID = require('steamid');

const TradeOffer = require('./classes/TradeOffer.js');

Util.inherits(TradeOfferManager, EventEmitter);

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
		global._steamTradeOfferManagerAssetCache = global._steamTradeOfferManagerAssetCache || new StdLib.DataStructures.LeastUsedCache(assetCacheSize, assetCacheGcInterval);
		this._assetCache = global._steamTradeOfferManagerAssetCache;
	} else {
		this._assetCache = new StdLib.DataStructures.LeastUsedCache(assetCacheSize, assetCacheGcInterval);
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
			let lang = require('languages').getLanguageInfo(this._language);
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
			let filename = 'polldata_' + this.steamID + '.json';
			this._getFromDisk([filename]).then((files) => {
				if (files[filename]) {
					try {
						this.pollData = JSON.parse(files[filename].toString('utf8'));
					} catch (ex) {
						this.emit('debug', 'Error parsing poll data from disk: ' + ex.message);
					}
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

	(async () => {
		try {
			if (this._dataGzip) {
				content = await new Promise((resolve, reject) => Zlib.gzip(content, (err, data) => {
					err ? reject(err) : resolve(data)
				}));
				filename += '.gz';
			}

			await this.storage.writeFile(filename, content);
		} catch (ex) {
			this.emit('debug', `Cannot save ${filename}: ${ex.message}`);
		}
	})();
};

/**
 * Get some files from disk.
 * @param {string[]} filenames
 * @returns {Promise<Object>} - Keys are filenames, values are Buffers of file contents
 * @private
 */
TradeOfferManager.prototype._getFromDisk = function(filenames) {
	return new Promise(async (resolve) => {
		if (!this.storage) {
			return resolve({});
		}

		if (this._dataGzip) {
			filenames = filenames.map(name => name + '.gz');
		}

		// readFiles never rejects
		/** @var {{filename: string, contents?: Buffer, error?: Error}[]} results */
		let results = await this.storage.readFiles(filenames);
		let files = {};
		results.forEach((file) => {
			if (file.contents) {
				files[file.filename] = file.contents;
			}
		});

		if (this._dataGzip) {
			let filenames = Object.keys(files);
			let unzipPromises = filenames.map((filename) => {
				new Promise((resolve) => {
					Zlib.gunzip(files[filename], (err, data) => {
						resolve(data || null);
					});
				});
			});

			let unzipped = await Promise.all(unzipPromises);
			let renamed = {};
			unzipped.forEach((unzippedContent, idx) => {
				let filename = filenames[idx];
				if (files.hasOwnProperty(filename)) {
					renamed[filename.replace(/\.gz$/, '')] = unzippedContent;
				}
			});

			return resolve(renamed);
		}

		resolve(files);
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
		let url = require('url').parse(partner, true);
		if (!url.query.partner) {
			throw new Error("Invalid trade URL");
		}

		partner = SteamID.fromIndividualAccountID(url.query.partner);
		token = url.query.token;
	}

	let offer = new TradeOffer(this, partner, token);
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
	return StdLib.Promises.callbackPromise(['offer'], callback, false, async (resolve, reject) => {
		let body = await this._apiCall('GET', 'GetTradeOffer', 1, {tradeofferid: id});
		if (!body.response) {
			return reject(new Error('Malformed API response'));
		}

		if (!body.response.offer) {
			return reject(new Error('No matching offer found'));
		}

		// Make sure the response is well-formed
		if (Helpers.offerMalformed(body.response.offer)) {
			return reject(new Error('Data temporarily unavailable'));
		}

		this._digestDescriptions(body.response.descriptions);
		await this._requestDescriptionsForOffers([body.response.offer]);
		resolve({offer: Helpers.createOfferFromData(this, body.response.offer)});
	});
};

/**
 * Get a list of trade offers either sent to you or by you
 * @param {int} filter
 * @param {Date} [historicalCutoff] - Pass a Date object in the past along with ActiveOnly to also get offers that were updated since this time
 * @param {function} [callback]
 */
TradeOfferManager.prototype.getOffers = function(filter, historicalCutoff, callback) {
	return StdLib.Promises.callbackPromise(['sent', 'received'], callback, false, async (resolve, reject) => {
		if ([EOfferFilter.ActiveOnly, EOfferFilter.HistoricalOnly, EOfferFilter.All].indexOf(filter) == -1) {
			return reject(new Error(`Unexpected value "${filter}" for "filter" parameter. Expected a value from the EOfferFilter enum.`));
		}

		if (typeof historicalCutoff === 'function') {
			callback = historicalCutoff;
			historicalCutoff = new Date(Date.now() + 31536000000);
		} else if (!historicalCutoff) {
			historicalCutoff = new Date(Date.now() + 31536000000);
		}

		// Currently the GetTradeOffers API doesn't include app_data, so we need to get descriptions from the WebAPI
		let body = await this._apiCall('GET', 'GetTradeOffers', 1, {
			get_sent_offers: 1,
			get_received_offers: 1,
			get_descriptions: 0,
			language: this._language,
			active_only: (filter == EOfferFilter.ActiveOnly) ? 1 : 0,
			historical_only: (filter == EOfferFilter.HistoricalOnly) ? 1 : 0,
			time_historical_cutoff: Math.floor(historicalCutoff.getTime() / 1000)
		});

		if (!body.response) {
			return reject(new Error('Malformed API response'));
		}

		// Make sure at least some offers are well-formed. Apparently some offers can be empty just forever. Because Steam.
		let allOffers = (body.response.trade_offers_sent || []).concat(body.response.trade_offers_received || []);
		if (allOffers.length > 0 && (allOffers.every(Helpers.offerMalformed) || allOffers.some(Helpers.offerSuperMalformed))) {
			return reject(new Error('Data temporarily unavailable'));
		}

		// Let's check the asset cache and see if we have descriptions that match these items.
		// If the necessary descriptions aren't in the asset cache, this will request them from the WebAPI and store
		// them for future use.
		try {
			await this._requestDescriptionsForOffers((body.response.trade_offers_sent || []).concat(body.response.trade_offers_received || []));
		} catch (ex) {
			return reject(new Error('Descriptions: ' + err.message));
		}

		let sent = (body.response.trade_offers_sent || []).map(data => Helpers.createOfferFromData(this, data));
		let received = (body.response.trade_offers_received || []).map(data => Helpers.createOfferFromData(this, data));

		resolve({sent, received});
		this.emit('offerList', filter, sent, received);
	});
};

//require('./classes/TradeSession.js');
