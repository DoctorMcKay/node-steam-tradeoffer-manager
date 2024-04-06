

module.exports = EconItem;

function EconItem(item) {
	for (const thing in item) {
		if (Object.hasOwn(item, thing)) {
			this[thing] = item[thing];
		}
	}

	if (this.id || this.assetid) {
		this.assetid = this.id = (this.id || this.assetid).toString();
	} else if (this.currencyid) {
		this.currencyid = this.currencyid.toString();
	}

	this.appid = this.appid ? Number.parseInt(this.appid, 10) : 0;
	this.classid = this.classid.toString();
	this.instanceid = (this.instanceid || 0).toString();
	this.amount = this.amount ? Number.parseInt(this.amount, 10) : 1;
	this.contextid = this.contextid.toString();

	this.fraudwarnings = fixArray(this.fraudwarnings);
	this.descriptions = fixArray(this.descriptions);
	this.owner_descriptions = fixArray(this.owner_descriptions);
	this.actions = fixArray(this.actions);
	this.owner_actions = fixArray(this.owner_actions);
	this.market_actions = fixArray(this.market_actions);
	this.tags = fixTags(this.tags);

	this.tradable = !!Number.parseInt(this.tradable, 10);
	this.marketable = !!Number.parseInt(this.marketable, 10);
	this.commodity = !!Number.parseInt(this.commodity, 10);
	this.market_tradable_restriction = this.market_tradable_restriction
		? Number.parseInt(this.market_tradable_restriction, 10)
		: 0;
	this.market_marketable_restriction = this.market_marketable_restriction
		? Number.parseInt(this.market_marketable_restriction, 10)
		: 0;

	if (this.appid === 753 && !this.market_fee_app && this.market_hash_name) {
		const match = this.market_hash_name.match(/^(\d+)\-/);
		if (match) {
			this.market_fee_app = Number.parseInt(match[1], 10);
		}
	}
}

function fixArray(obj) {
	if (typeof obj === "undefined" || obj === "") {
		return [];
	}

	const array = [];
	for (const i in obj) {
		if (Object.hasOwn(obj, i)) {
			array[i] = obj[i];
		}
	}

	return array;
}

function fixTags(tags) {
	if (!(Array.isArray(tags))) {
		tags = fixArray(tags);
	}

	return tags.map((tag) => {
		// tag.internal_name is always present
		// tag.category is always present
		tag.name = tag.localized_tag_name = tag.localized_tag_name || tag.name;
		tag.color = tag.color || "";
		tag.category_name = tag.localized_category_name =
			tag.localized_category_name || tag.category_name;
		return tag;
	});
}

EconItem.prototype.getImageURL = function () {
	return (
		`https://steamcommunity-a.akamaihd.net/economy/image/${this.icon_url}/`
	);
};

EconItem.prototype.getLargeImageURL = function () {
	if (!this.icon_url_large) {
		return this.getImageURL();
	}

	return (
		`https://steamcommunity-a.akamaihd.net/economy/image/${this.icon_url_large}/`
	);
};

EconItem.prototype.getTag = function (category) {
	if (!this.tags) {
		return null;
	}

	for (let i = 0; i < this.tags.length; i++) {
		if (this.tags[i].category === category) {
			return this.tags[i];
		}
	}

	return null;
};
