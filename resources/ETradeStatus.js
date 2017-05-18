module.exports = {
	// Trade has just been accepted/confirmed, but no work has been done yet
	Init: 0,
	// Steam is about to start committing the trade
	PreCommitted: 1,
	// The items have been exchanged
	Committed: 2,
	// All work is finished
	Complete: 3,
	// Something went wrong after Init, but before Committed, and the trade has been rolled back
	Failed: 4,
	// A support person rolled back the trade for one side
	PartialSupportRollback: 5,
	// A support person rolled back the trade for both sides
	FullSupportRollback: 6,
	// A support person rolled back the trade for some set of items
	SupportRollback_Selective: 7,
	// We tried to roll back the trade when it failed,
	// but haven't managed to do that for all items yet
	RollbackFailed: 8,
	// We tried to roll back the trade, but some failure didn't go away and we gave up
	RollbackAbandoned: 9,
	// Trade is in escrow
	InEscrow: 10,
	// A trade in escrow was rolled back
	EscrowRollback: 11,

	0: 'Init',
	1: 'PreCommitted',
	2: 'Committed',
	3: 'Complete',
	4: 'Failed',
	5: 'PartialSupportRollback',
	6: 'FullSupportRollback',
	7: 'SupportRollback_Selective',
	8: 'RollbackFailed',
	9: 'RollbackAbandoned',
	10: 'InEscrow',
	11: 'EscrowRollback',
};
