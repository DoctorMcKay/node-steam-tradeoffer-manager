module.exports = {
	"Init": 0,                           // Trade has just been accepted/confirmed, but no work has been done yet
	"PreCommitted": 1,                   // Steam is about to start committing the trade
	"Committed": 2,                      // The items have been exchanged
	"Complete": 3,                       // All work is finished
	"Failed": 4,                         // Something went wrong after Init, but before Committed, and the trade has been rolled back
	"PartialSupportRollback": 5,         // A support person rolled back the trade for one side
	"FullSupportRollback": 6,            // A support person rolled back the trade for both sides
	"SupportRollback_Selective": 7,      // A support person rolled back the trade for some set of items
	"RollbackFailed": 8,                 // We tried to roll back the trade when it failed, but haven't managed to do that for all items yet
	"RollbackAbandoned": 9,              // We tried to roll back the trade, but some failure didn't go away and we gave up
	"InEscrow": 10,                      // Trade is in escrow
	"EscrowRollback": 11,                // A trade in escrow was rolled back

	"0": "Init",
	"1": "PreCommitted",
	"2": "Committed",
	"3": "Complete",
	"4": "Failed",
	"5": "PartialSupportRollback",
	"6": "FullSupportRollback",
	"7": "SupportRollback_Selective",
	"8": "RollbackFailed",
	"9": "RollbackAbandoned",
	"10": "InEscrow",
	"11": "EscrowRollback"
};
