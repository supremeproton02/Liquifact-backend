#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, token, Address, Env, Symbol,
};

// ── Error Types ──────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TransferError {
    /// The transfer amount must be strictly positive.
    TransferAmountNotPositive,
    /// The recipient's balance delta did not match the expected amount.
    RecipientBalanceDeltaMismatch,
    /// The sender's balance delta did not match the expected direction (non-positive for outbound, non-negative for inbound).
    SenderBalanceDeltaMismatch,
}

// ── Storage keys ────────────────────────────────────────────────────────────

#[contracttype]
pub enum DataKey {
    FeeRecipient,
    Bounty(u64),
    NextId,
}

// ── Data types ───────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub struct Bounty {
    pub creator:          Address,
    pub hunter:           Address,
    pub token:            Address,
    pub amount:           i128,
    pub protocol_fee_bps: u32,
    pub released:         bool,
}

// ── External Calls Helpers ───────────────────────────────────────────────────

pub mod external_calls {
    use super::*;
    use soroban_sdk::{token, Address, Env};

    /// Transfer tokens from an external sender into the contract, with strict balance-delta checks.
    ///
    /// # Invariants
    /// - The amount must be strictly positive.
    /// - The contract's balance must increase by exactly `amount` after the transfer.
    /// - The sender's balance must not increase (i.e., delta ≤ 0) after the transfer.
    ///
    /// # Errors
    /// - `TransferError::TransferAmountNotPositive` if `amount` is ≤ 0.
    /// - `TransferError::RecipientBalanceDeltaMismatch` if contract balance delta ≠ `amount`.
    /// - `TransferError::SenderBalanceDeltaMismatch` if sender balance delta > 0.
    pub fn transfer_into_escrow_with_balance_checks(
        env: &Env,
        token: &Address,
        from: &Address,
        amount: i128,
    ) -> Result<(), TransferError> {
        if amount <= 0 {
            return Err(TransferError::TransferAmountNotPositive);
        }

        let token_client = token::Client::new(env, token);
        let contract_address = env.current_contract_address();

        // Record pre-transfer balances
        let pre_contract_balance = token_client.balance(&contract_address);
        let pre_sender_balance = token_client.balance(from);

        // Perform the transfer
        token_client.transfer(from, &contract_address, &amount);

        // Record post-transfer balances
        let post_contract_balance = token_client.balance(&contract_address);
        let post_sender_balance = token_client.balance(from);

        // Verify contract received exactly the expected amount
        let contract_delta = post_contract_balance - pre_contract_balance;
        if contract_delta != amount {
            return Err(TransferError::RecipientBalanceDeltaMismatch);
        }

        // Verify sender's balance did not increase
        let sender_delta = post_sender_balance - pre_sender_balance;
        if sender_delta > 0 {
            return Err(TransferError::SenderBalanceDeltaMismatch);
        }

        Ok(())
    }

    /// Transfer tokens from the contract to an external recipient, with strict balance-delta checks.
    ///
    /// # Invariants
    /// - The amount must be strictly positive.
    /// - The recipient's balance must increase by exactly `amount` after the transfer.
    /// - The contract's balance must not increase (i.e., delta ≤ 0) after the transfer.
    ///
    /// # Errors
    /// - `TransferError::TransferAmountNotPositive` if `amount` is ≤ 0.
    /// - `TransferError::RecipientBalanceDeltaMismatch` if recipient balance delta ≠ `amount`.
    /// - `TransferError::SenderBalanceDeltaMismatch` if contract balance delta > 0.
    pub fn transfer_funding_token_with_balance_checks(
        env: &Env,
        token: &Address,
        to: &Address,
        amount: i128,
    ) -> Result<(), TransferError> {
        if amount <= 0 {
            return Err(TransferError::TransferAmountNotPositive);
        }

        let token_client = token::Client::new(env, token);
        let contract_address = env.current_contract_address();

        // Record pre-transfer balances
        let pre_contract_balance = token_client.balance(&contract_address);
        let pre_recipient_balance = token_client.balance(to);

        // Perform the transfer
        token_client.transfer(&contract_address, to, &amount);

        // Record post-transfer balances
        let post_contract_balance = token_client.balance(&contract_address);
        let post_recipient_balance = token_client.balance(to);

        // Verify recipient received exactly the expected amount
        let recipient_delta = post_recipient_balance - pre_recipient_balance;
        if recipient_delta != amount {
            return Err(TransferError::RecipientBalanceDeltaMismatch);
        }

        // Verify contract's balance did not increase
        let contract_delta = post_contract_balance - pre_contract_balance;
        if contract_delta > 0 {
            return Err(TransferError::SenderBalanceDeltaMismatch);
        }

        Ok(())
    }
}

// ── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct BountyContract;

#[contractimpl]
impl BountyContract {
    /// One-time initialiser — sets the fee recipient address.
    pub fn initialize(env: Env, fee_recipient: Address) {
        if env.storage().instance().has(&DataKey::FeeRecipient) {
            panic!("already initialized");
        }
        env.storage()
            .instance()
            .set(&DataKey::FeeRecipient, &fee_recipient);
        env.storage().instance().set(&DataKey::NextId, &0u64);
    }

    /// Create a bounty.
    ///
    /// `protocol_fee_bps` is optional (pass 0 for no fee).  The full `amount`
    /// is transferred from the caller into the contract escrow immediately.
    pub fn create_bounty(
        env: Env,
        creator: Address,
        hunter: Address,
        token: Address,
        amount: i128,
        protocol_fee_bps: u32,
    ) -> u64 {
        creator.require_auth();

        assert!(amount > 0, "amount must be positive");
        assert!(protocol_fee_bps <= 10_000, "fee_bps must be <= 10000");

        // Pull funds into the contract using the new helper
        external_calls::transfer_into_escrow_with_balance_checks(&env, &token, &creator, amount)
            .unwrap_or_else(|e| panic!("transfer failed: {:?}", e));

        let id: u64 = env.storage().instance().get(&DataKey::NextId).unwrap_or(0);
        let bounty = Bounty {
            creator,
            hunter,
            token,
            amount,
            protocol_fee_bps,
            released: false,
        };
        env.storage().persistent().set(&DataKey::Bounty(id), &bounty);
        env.storage().instance().set(&DataKey::NextId, &(id + 1));

        env.events().publish(
            (Symbol::new(&env, "bounty_created"), id),
            amount,
        );

        id
    }

    /// Release a bounty to the hunter, deducting the protocol fee first.
    ///
    /// Fee is deducted from the payout (not added on top).
    /// A fee of 0 bps results in the full amount going to the hunter.
    pub fn release_bounty(env: Env, id: u64) {
        let mut bounty: Bounty = env
            .storage()
            .persistent()
            .get(&DataKey::Bounty(id))
            .expect("bounty not found");

        bounty.creator.require_auth();
        assert!(!bounty.released, "already released");

        let fee_recipient: Address = env
            .storage()
            .instance()
            .get(&DataKey::FeeRecipient)
            .expect("not initialized");

        // fee = amount * bps / 10_000 (integer division, rounds down)
        let fee: i128 = bounty.amount * (bounty.protocol_fee_bps as i128) / 10_000;
        let payout: i128 = bounty.amount - fee;

        if fee > 0 {
            external_calls::transfer_funding_token_with_balance_checks(&env, &bounty.token, &fee_recipient, fee)
                .unwrap_or_else(|e| panic!("fee transfer failed: {:?}", e));
        }
        external_calls::transfer_funding_token_with_balance_checks(&env, &bounty.token, &bounty.hunter, payout)
            .unwrap_or_else(|e| panic!("payout transfer failed: {:?}", e));

        bounty.released = true;
        env.storage().persistent().set(&DataKey::Bounty(id), &bounty);

        env.events().publish(
            (Symbol::new(&env, "bounty_released"), id),
            (payout, fee),
        );
    }

    /// Read a bounty (view helper).
    pub fn get_bounty(env: Env, id: u64) -> Bounty {
        env.storage()
            .persistent()
            .get(&DataKey::Bounty(id))
            .expect("bounty not found")
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{
        testutils::Address as _,
        token::{Client as TokenClient, StellarAssetClient},
        Address, Env,
    };

    // ── helpers ──────────────────────────────────────────────────────────────

    fn setup() -> (Env, Address, Address, Address, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, BountyContract);

        let fee_recipient = Address::generate(&env);
        let creator       = Address::generate(&env);
        let hunter        = Address::generate(&env);

        // Deploy a test token and mint to creator.
        let token_admin = Address::generate(&env);
        let token_id    = env.register_stellar_asset_contract_v2(token_admin.clone());
        let token_addr  = token_id.address();
        let sac         = StellarAssetClient::new(&env, &token_addr);
        sac.mint(&creator, &10_000_i128);

        let client = BountyContractClient::new(&env, &contract_id);
        client.initialize(&fee_recipient);

        (env, contract_id, fee_recipient, creator, hunter, token_addr)
    }

    // ── 0 % fee ──────────────────────────────────────────────────────────────

    #[test]
    fn test_zero_fee_full_payout() {
        let (env, contract_id, _fee_recipient, creator, hunter, token) = setup();
        let client = BountyContractClient::new(&env, &contract_id);

        let id = client.create_bounty(&creator, &hunter, &token, &1_000_i128, &0u32);

        let token_client = TokenClient::new(&env, &token);
        let hunter_before = token_client.balance(&hunter);

        client.release_bounty(&id);

        let hunter_after = token_client.balance(&hunter);
        assert_eq!(hunter_after - hunter_before, 1_000_i128, "hunter should receive full amount");
    }

    // ── 1 % fee ──────────────────────────────────────────────────────────────

    #[test]
    fn test_one_percent_fee() {
        let (env, contract_id, fee_recipient, creator, hunter, token) = setup();
        let client = BountyContractClient::new(&env, &contract_id);

        // 1 % = 100 bps
        let id = client.create_bounty(&creator, &hunter, &token, &1_000_i128, &100u32);

        let token_client    = TokenClient::new(&env, &token);
        let hunter_before   = token_client.balance(&hunter);
        let recipient_before = token_client.balance(&fee_recipient);

        client.release_bounty(&id);

        let hunter_after    = token_client.balance(&hunter);
        let recipient_after = token_client.balance(&fee_recipient);

        assert_eq!(hunter_after   - hunter_before,    990_i128, "hunter should receive 990");
        assert_eq!(recipient_after - recipient_before,  10_i128, "fee recipient should receive 10");
    }

    // ── 5 % fee ──────────────────────────────────────────────────────────────

    #[test]
    fn test_five_percent_fee() {
        let (env, contract_id, fee_recipient, creator, hunter, token) = setup();
        let client = BountyContractClient::new(&env, &contract_id);

        // 5 % = 500 bps
        let id = client.create_bounty(&creator, &hunter, &token, &2_000_i128, &500u32);

        let token_client    = TokenClient::new(&env, &token);
        let hunter_before   = token_client.balance(&hunter);
        let recipient_before = token_client.balance(&fee_recipient);

        client.release_bounty(&id);

        let hunter_after    = token_client.balance(&hunter);
        let recipient_after = token_client.balance(&fee_recipient);

        assert_eq!(hunter_after   - hunter_before,   1_900_i128, "hunter should receive 1900");
        assert_eq!(recipient_after - recipient_before,  100_i128, "fee recipient should receive 100");
    }

    // ── double-release guard ─────────────────────────────────────────────────

    #[test]
    #[should_panic(expected = "already released")]
    fn test_cannot_release_twice() {
        let (env, contract_id, _fee_recipient, creator, hunter, token) = setup();
        let client = BountyContractClient::new(&env, &contract_id);
        let id = client.create_bounty(&creator, &hunter, &token, &500_i128, &0u32);
        client.release_bounty(&id);
        client.release_bounty(&id); // should panic
    }

    // ── External Calls Tests ────────────────────────────────────────────────

    mod external_calls_tests {
        use super::*;
        use soroban_sdk::{
            testutils::Address as _,
            token::{Client as TokenClient, StellarAssetClient},
            Address, Env,
        };

        #[test]
        fn test_transfer_into_escrow_happy_path() {
            let env = Env::default();
            env.mock_all_auths();

            let contract_id = env.register_contract(None, BountyContract);
            let client = BountyContractClient::new(&env, &contract_id);
            let fee_recipient = Address::generate(&env);
            client.initialize(&fee_recipient);

            let creator = Address::generate(&env);
            let token_admin = Address::generate(&env);
            let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
            let token_addr = token_id.address();
            let sac = StellarAssetClient::new(&env, &token_addr);
            sac.mint(&creator, &1000_i128);

            let result = external_calls::transfer_into_escrow_with_balance_checks(
                &env,
                &token_addr,
                &creator,
                500_i128,
            );
            assert!(result.is_ok());
        }

        #[test]
        #[should_panic]
        fn test_transfer_into_escrow_zero_amount() {
            let env = Env::default();
            env.mock_all_auths();

            let contract_id = env.register_contract(None, BountyContract);
            let client = BountyContractClient::new(&env, &contract_id);
            let fee_recipient = Address::generate(&env);
            client.initialize(&fee_recipient);

            let creator = Address::generate(&env);
            let token_admin = Address::generate(&env);
            let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
            let token_addr = token_id.address();

            external_calls::transfer_into_escrow_with_balance_checks(
                &env,
                &token_addr,
                &creator,
                0_i128,
            ).unwrap();
        }

        #[test]
        fn test_transfer_funding_token_happy_path() {
            let env = Env::default();
            env.mock_all_auths();

            let contract_id = env.register_contract(None, BountyContract);
            let client = BountyContractClient::new(&env, &contract_id);
            let fee_recipient = Address::generate(&env);
            client.initialize(&fee_recipient);

            let recipient = Address::generate(&env);
            let token_admin = Address::generate(&env);
            let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
            let token_addr = token_id.address();
            let sac = StellarAssetClient::new(&env, &token_addr);
            let contract_addr = env.current_contract_address();
            sac.mint(&contract_addr, &1000_i128);

            let result = external_calls::transfer_funding_token_with_balance_checks(
                &env,
                &token_addr,
                &recipient,
                500_i128,
            );
            assert!(result.is_ok());
        }
    }
}
