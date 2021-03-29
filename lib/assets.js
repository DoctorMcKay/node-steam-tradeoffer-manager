"use strict";

const EconItem = require('./classes/EconItem.js');
const TradeOfferManager = require('./index.js');

const ITEMS_PER_CLASSINFO_REQUEST = 100;

/**
 * Stores item descriptions in the internal description cache.
 * @param {Object[]|Object} descriptions
 * @private
 */
TradeOfferManager.prototype._digestDescriptions = function(descriptions) {
	let cache = this._assetCache;

	if (!this._language) {
		return;
	}

	if (descriptions && !Array.isArray(descriptions)) {
		descriptions = Object.values(descriptions);
	}

	(descriptions || []).forEach((item) => {
		if (!item || !item.appid || !item.classid) {
			return;
		}

		cache.add(`${item.appid}_${item.classid}_${item.instanceid || '0'}`, item);
		this._persistToDisk(`asset_${item.appid}_${item.classid}_${item.instanceid || '0'}.json`, JSON.stringify(item));
	});
};

/**
 * Attaches item descriptions to some items from our internal description cache.
 * Does not request missing descriptions.
 * @param {int} appid
 * @param {int} contextid
 * @param {Object[]|Object} items
 * @returns {EconItem[]}
 * @private
 */
TradeOfferManager.prototype._mapItemsToDescriptions = function(appid, contextid, items) {
	let cache = this._assetCache;

	if (!Array.isArray(items)) {
		items = Object.values(items);
	}

	return items.map((item) => {
		item.appid = appid || item.appid;
		item.contextid = contextid || item.contextid;

		let key = `${item.appid}_${item.classid}_${item.instanceid || '0'}`;
		let entry = cache.get(key);
		if (!entry) {
			// This item isn't in our description cache
			return new EconItem(item);
		}

		for (let i in entry) {
			if (entry.hasOwnProperty(i)) {
				item[i] = entry[i];
			}
		}

		return new EconItem(item);
	});
};

/**
 * Checks whether we have a description for a given item in our cache.
 * @param {{appid?: int, classid: int|string, instanceid?: int|string}} item
 * @param {int} [appid]
 * @returns {boolean}
 * @private
 */
TradeOfferManager.prototype._hasDescription = function(item, appid) {
	appid = appid || item.appid;
	return !!this._assetCache.get(appid + '_' + item.classid + '_' + (item.instanceid || '0'));
};

/**
 * Adds descriptions to a set of items. Requests missing descriptions from the API.
 * @param {Object[]} items
 * @param {function} callback
 * @private
 */
TradeOfferManager.prototype._addDescriptions = function(items, callback) {
	let descriptionRequired = items.filter(item => !this._hasDescription(item));

	if (descriptionRequired.length == 0) {
		callback(null, this._mapItemsToDescriptions(null, null, items));
		return;
	}

	this._requestDescriptions(descriptionRequired, (err) => {
		if (err) {
			callback(err);
		} else {
			callback(null, this._mapItemsToDescriptions(null, null, items));
		}
	});
};

/**
 * Requests descriptions for a set of classes from the API.
 * @param {{appid: int, classid: int|string, instanceid?: int|string}[]} classes
 * @returns {Promise}
 * @private
 */
TradeOfferManager.prototype._requestDescriptions = async function(classes) {
	let getFromSteam = async () => {

	};

	// Get whatever we can from disk
	let filenames = classes.map(item => `asset_${item.appid}_${item.classid}_${item.instanceid || '0'}.json`);
	let files = await this._getFromDisk(filenames); // _getFromDisk never rejects
	for (let filename in files) {
		let match = filename.match(/asset_(\d+_\d+_\d+)\.json/);
		if (!match) {
			this.emit('debug', `Shouldn't be possible, but filename ${filename} doesn't match regex`);
			continue; // shouldn't be possible
		}

		try {
			this._assetCache.add(match[1], JSON.parse(files[filename].toString('utf8')));
		} catch (ex) {
			this.emit('debug', `Error parsing description file ${filename}: ${ex.message}`);
		}
	}

	// get the rest from steam
	let apps = [];
	let appids = [];

	// Split this out into appids
	classes.forEach((item) => {
		// Don't add this if we already have it in the cache
		if (this._assetCache.get(`${item.appid}_${item.classid}_${item.instanceid || '0'}`)) {
			return;
		}

		let index = appids.indexOf(item.appid);
		if (index == -1) {
			index = appids.push(item.appid) - 1;
			let arr = [];
			arr.appid = item.appid;
			apps.push(arr);
		}

		// Don't add a class/instanceid pair that we already have in the list
		if (apps[index].indexOf(item.classid + '_' + (item.instanceid || '0')) == -1) {
			apps[index].push(item.classid + '_' + (item.instanceid || '0'));
		}
	});

	let appPromises = [];
	apps.forEach((app) => {
		appPromises.push(new Promise(async (resolve) => {
			let chunks = [];

			// Split this into chunks of ITEMS_PER_CLASSINFO_REQUEST items
			while (app.length > 0) {
				chunks.push(app.splice(0, ITEMS_PER_CLASSINFO_REQUEST));
			}

			let chunkPromises = [];
			chunks.forEach((chunk) => {
				chunkPromises.push(new Promise(async (resolve, reject) => {
					let input = {
						appid: app.appid,
						language: this._language,
						class_count: chunk.length
					};

					chunk.forEach((item, index) => {
						let parts = item.split('_');
						input['classid' + index] = parts[0];
						input['instanceid' + index] = parts[1];
					});

					try {
						this.emit('debug', `Requesting classinfo for ${chunk.length} items from app ${app.appid}`);
						let body = await this._apiCall('GET', {iface: 'ISteamEconomy', method: 'GetAssetClassInfo'}, 1, input);
						if (!body.result || !body.result.success) {
							return reject(new Error('Invalid API response'));
						}

						let chunkItems = Object.keys(body.result).map((id) => {
							if (!id.match(/^\d+(_\d+)?$/)) {
								return null;
							}

							let item = body.result[id];
							item.appid = app.appid;
							return item;
						}).filter(item => !!item);

						this._digestDescriptions(chunkItems);
						resolve();
					} catch (ex) {
						return reject(ex);
					}
				}));
			});

			await Promise.all(chunkPromises);
			resolve();
		}));
	});

	// None of the appPromises can reject so this will always succeed
	await Promise.all(appPromises);
};
