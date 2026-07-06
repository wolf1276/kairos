import { ProtocolConfig, ProtocolId } from './types';

/**
 * Static, per-network catalog of known protocol contracts. Deliberately not an on-chain
 * registry — this is config the SDK ships with, versioned like `NETWORKS` in `../config`,
 * so adding/updating a protocol is a release rather than a contract migration.
 */
export const PROTOCOL_REGISTRY: Record<'testnet' | 'mainnet', Partial<Record<ProtocolId, ProtocolConfig>>> = {
  testnet: {
    blend: {
      // Blend testnet lending pool instance ("TestnetV2"), deployed via Blend's poolFactoryV2.
      contractId: 'CCEBVDYM32YNYCVNRXQKDFFPISJJCV557CDZEIRBEE4NCV4KHPQ44HGF',
      kind: 'lending',
    },
    soroswap: {
      // Soroswap testnet router.
      contractId: 'CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD',
      kind: 'amm',
    },
  },
  mainnet: {},
};

/**
 * Blend testnet asset contract IDs, useful when constructing `BlendAdapter.deposit`/`withdraw`
 * calls (the `asset` param). Source: Blend's testnet deployment config, provided by the user.
 */
export const BLEND_TESTNET_ASSETS = {
  XLM: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
  BLND: 'CB22KRA3YZVCNCQI64JQ5WE7UY2VAV7WFLK6A2JN3HEX56T2EDAFO7QF',
  USDC: 'CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU',
  wETH: 'CAZAQB3D7KSLSNOSQKYD2V4JP5V2Y3B4RDJZRLBFCCIXDCTE3WHSY3UE',
  wBTC: 'CAP5AMC2OHNVREO66DFIN6DHJMPOBAJ2KCDDIMFBR7WWJH5RZBFM3UEI',
} as const;
