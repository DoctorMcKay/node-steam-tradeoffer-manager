module.exports = {
	"Active": 0,                           // The trade session is in progress and the parties are deciding what to do
	"Complete": 1,                         // The trade has been accepted and completed
	"Empty": 2,                            // The trade was accepted but there were no items on either side
	"Canceled": 3,                         // The trade was canceled by one of the parties
	"TimedOut": 4,                         // One of the parties stopped polling so the trade timed out
	"Failed": 5,                           // There was a backend problem and the trade failed. No items were exchanged.
	"TurnedIntoTradeOffer": 6,             // This trade is now a trade offer

	"0": "Active",
	"1": "Complete",
	"2": "Empty",
	"3": "Canceled",
	"4": "TimedOut",
	"5": "Failed",
	"6": "TurnedIntoTradeOffer"
};
