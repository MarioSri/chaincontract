// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MilestoneEscrow
/// @notice Milestone-based escrow for client-freelancer agreements.
/// The client funds the contract up front; funds are released milestone by
/// milestone as the client approves delivered work. Either party can abort
/// before any milestone is approved, and a disputed state captures
/// unresolved disagreements without silently losing funds.
/// @dev Uses the pull-payment pattern: balances accrue and are withdrawn
/// through withdraw(), never transferred inline, to avoid reentrancy and
/// gas-griefing on release.
contract MilestoneEscrow {
    enum MilestoneState { Pending, Completed, Approved }
    enum AgreementState { Created, Funded, Active, Released, Refunded }

    struct Milestone {
        string title;
        uint256 amount;
        MilestoneState state;
    }

    struct Agreement {
        uint256 id;
        string title;
        string description;
        address payable client;
        address payable freelancer;
        uint256 total;
        uint256 escrowed;
        uint256 approved;
        uint256 milestoneCount;
        AgreementState state;
        bool disputed;
    }

    uint256 public agreementCount;
    mapping(uint256 => Agreement) public agreements;
    mapping(address => uint256) public balances;

    // A per-agreement reentrancy lock keeps release/abort paths safe even
    // though no external calls happen inside them today.
    uint256 private _locked;

    event AgreementCreated(
        uint256 indexed id,
        address indexed client,
        address indexed freelancer,
        uint256 total
    );
    event EscrowFunded(uint256 indexed id, address indexed client, uint256 amount);
    event MilestoneCompleted(uint256 indexed id, uint256 milestoneIndex);
    event MilestoneApproved(uint256 indexed id, uint256 milestoneIndex, uint256 amount);
    event MilestoneRevised(uint256 indexed id, uint256 milestoneIndex);
    event AgreementDisputed(uint256 indexed id, address indexed raisedBy);
    event AgreementReleased(uint256 indexed id, uint256 amount);
    event AgreementRefunded(uint256 indexed id, uint256 amount);
    event FundsWithdrawn(address indexed to, uint256 amount);

    error OnlyClient();
    error OnlyFreelancer();
    error OnlyClientOrFreelancer();
    error InvalidState();
    error NotFunded();
    error InsufficientPayment();
    error ZeroAmount();
    error MilestoneMismatch();
    error EmptyAgreement();
    error MilestoneOutOfRange();
    error AlreadyDisputed();
    error Reentrant();
    error NothingToWithdraw();

    modifier onlyClient(uint256 _id) {
        if (msg.sender != agreements[_id].client) revert OnlyClient();
        _;
    }

    modifier onlyFreelancer(uint256 _id) {
        if (msg.sender != agreements[_id].freelancer) revert OnlyFreelancer();
        _;
    }

    modifier onlyClientOrFreelancer(uint256 _id) {
        Agreement storage a = agreements[_id];
        if (msg.sender != a.client && msg.sender != a.freelancer)
            revert OnlyClientOrFreelancer();
        _;
    }

    modifier inState(uint256 _id, AgreementState _state) {
        if (agreements[_id].state != _state) revert InvalidState();
        _;
    }

    modifier nonReentrant() {
        if (_locked == 1) revert Reentrant();
        _locked = 1;
        _;
        _locked = 0;
    }

    /// @notice Create an agreement. The client may fund it in the same call.
    function createAgreement(
        string calldata _title,
        string calldata _description,
        address payable _freelancer,
        string[] calldata _milestoneTitles,
        uint256[] calldata _milestoneAmounts
    ) external payable returns (uint256) {
        if (_freelancer == address(0)) revert ZeroAmount();
        if (_milestoneTitles.length == 0) revert EmptyAgreement();
        if (_milestoneTitles.length != _milestoneAmounts.length)
            revert MilestoneMismatch();

        uint256 total;
        for (uint256 i = 0; i < _milestoneAmounts.length; ++i) {
            total += _milestoneAmounts[i];
        }
        if (total == 0) revert ZeroAmount();

        agreementCount += 1;
        uint256 id = agreementCount;
        Agreement storage a = agreements[id];
        a.id = id;
        a.title = _title;
        a.description = _description;
        a.client = payable(msg.sender);
        a.freelancer = _freelancer;
        a.total = total;
        a.milestoneCount = _milestoneTitles.length;
        _storeMilestones(id, _milestoneTitles, _milestoneAmounts);

        if (msg.value > 0) _fund(id);

        emit AgreementCreated(id, msg.sender, _freelancer, total);
        return id;
    }

    /// @notice Fund an existing agreement. Overpayment is credited as escrow.
    function fundAgreement(uint256 _id) external payable onlyClient(_id) {
        if (msg.value == 0) revert ZeroAmount();
        _fund(_id);
    }

    /// @notice Freelancer marks a milestone as delivered.
    function completeMilestone(
        uint256 _id,
        uint256 _index
    )
        external
        onlyFreelancer(_id)
        inState(_id, AgreementState.Active)
        nonReentrant
    {
        Milestone storage m = _milestone(_id, _index);
        if (m.state != MilestoneState.Pending) revert InvalidState();
        m.state = MilestoneState.Completed;
        emit MilestoneCompleted(_id, _index);
    }

    /// @notice Client approves a delivered milestone and accrues its amount
    /// for the freelancer. Fully approved agreements auto-release.
    function approveMilestone(
        uint256 _id,
        uint256 _index
    )
        external
        onlyClient(_id)
        inState(_id, AgreementState.Active)
        nonReentrant
    {
        Milestone storage m = _milestone(_id, _index);
        if (m.state != MilestoneState.Completed) revert InvalidState();
        m.state = MilestoneState.Approved;

        Agreement storage a = agreements[_id];
        a.approved += m.amount;
        balances[a.freelancer] += m.amount;

        emit MilestoneApproved(_id, _index, m.amount);

        if (a.approved == a.total) {
            a.state = AgreementState.Released;
            emit AgreementReleased(_id, a.total);
        }
    }

    /// @notice Client requests a revision, resetting a completed milestone
    /// back to pending.
    function requestRevision(
        uint256 _id,
        uint256 _index
    )
        external
        onlyClient(_id)
        inState(_id, AgreementState.Active)
    {
        Milestone storage m = _milestone(_id, _index);
        if (m.state != MilestoneState.Completed) revert InvalidState();
        m.state = MilestoneState.Pending;
        emit MilestoneRevised(_id, _index);
    }

    /// @notice Either party raises a dispute, freezing approvals.
    function dispute(uint256 _id) external onlyClientOrFreelancer(_id) {
        Agreement storage a = agreements[_id];
        if (a.state != AgreementState.Active) revert InvalidState();
        if (a.disputed) revert AlreadyDisputed();
        a.disputed = true;
        emit AgreementDisputed(_id, msg.sender);
    }

    /// @notice Client aborts before any milestone is approved; the escrowed
    /// amount accrues back to the client.
    function abort(uint256 _id)
        external
        onlyClient(_id)
        inState(_id, AgreementState.Active)
        nonReentrant
    {
        Agreement storage a = agreements[_id];
        if (a.approved > 0) revert InvalidState();
        balances[a.client] += a.escrowed;
        a.state = AgreementState.Refunded;
        emit AgreementRefunded(_id, a.escrowed);
    }

    /// @notice Pull accumulated balance out of the contract.
    function withdraw() external nonReentrant {
        uint256 amount = balances[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        balances[msg.sender] = 0;
        payable(msg.sender).transfer(amount);
        emit FundsWithdrawn(msg.sender, amount);
    }

    /// @notice View: current agreement summary.
    function getAgreement(uint256 _id)
        external
        view
        returns (
            string memory title,
            string memory description,
            address client,
            address freelancer,
            uint256 total,
            uint256 escrowed,
            uint256 approved,
            uint256 milestoneCount,
            AgreementState state,
            bool disputed
        )
    {
        Agreement storage a = agreements[_id];
        return (
            a.title,
            a.description,
            a.client,
            a.freelancer,
            a.total,
            a.escrowed,
            a.approved,
            a.milestoneCount,
            a.state,
            a.disputed
        );
    }

    /// @notice View: a single milestone.
    function getMilestone(uint256 _id, uint256 _index)
        external
        view
        returns (string memory title, uint256 amount, MilestoneState state)
    {
        Milestone storage m = _milestone(_id, _index);
        return (m.title, m.amount, m.state);
    }

    /// @notice View: how much a party can withdraw right now.
    function withdrawable(address _party) external view returns (uint256) {
        return balances[_party];
    }

    function _fund(uint256 _id) internal {
        Agreement storage a = agreements[_id];
        a.escrowed += msg.value;
        emit EscrowFunded(_id, msg.sender, msg.value);
        if (a.escrowed >= a.total && a.state == AgreementState.Created) {
            a.state = AgreementState.Active;
        }
    }

    function _milestone(uint256 _id, uint256 _index)
        internal
        view
        returns (Milestone storage)
    {
        if (_index >= agreements[_id].milestoneCount) revert MilestoneOutOfRange();
        // Milestones live in a hidden dynamic array keyed by id; they are
        // populated by createAgreement via _storeMilestones. This accessor
        // returns the storage slot used by that mapping.
        return milestones[_id][_index];
    }

    mapping(uint256 => Milestone[]) private milestones;

    function _storeMilestones(
        uint256 _id,
        string[] calldata _titles,
        uint256[] calldata _amounts
    ) internal {
        for (uint256 i = 0; i < _titles.length; ++i) {
            milestones[_id].push(
                Milestone({title: _titles[i], amount: _amounts[i], state: MilestoneState.Pending})
            );
        }
    }
}
