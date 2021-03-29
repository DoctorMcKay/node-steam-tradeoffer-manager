module.exports = {
	"AddItem": 0,                        // An item was added to the trade
	"RemoveItem": 1,                     // An item was removed from the trade
	"Ready": 2,                          // A party has readied up
	"Unready": 3,                        // A party has unreadied
	"Confirm": 4,                        // A party has confirmed
	// 5 = ???
	// 6 = added/removed currency, which we don't support
	"Chat": 7,                           // A party has sent a chat message

	"0": "AddItem",
	"1": "RemoveItem",
	"2": "Ready",
	"3": "Unready",
	"4": "Confirm",
	"7": "Chat"
};
