import type { LinkedRiskSource, DirectExposureObject, RiskObjectType } from '../types';

export interface ObligationExposureLinks {
  linked_risk_sources: LinkedRiskSource[];
  direct_exposure_objects: DirectExposureObject[];
  explanation_chain: string[];
}

export function buildObligationExposureLinks(obligation: {
  obligation_id: string;
  related_entity_id?: string;
  entity_id?: string;
  related_asset_id?: string;
  asset_id?: string;
  [key: string]: any;
}): ObligationExposureLinks {
  const direct_exposure_objects: DirectExposureObject[] = [];
  const explanation_chain: string[] = [];

  const entityId = obligation.related_entity_id || obligation.entity_id;
  const assetId  = obligation.related_asset_id  || obligation.asset_id;

  if (entityId) {
    direct_exposure_objects.push({
      object_type:  'entity',
      object_id:    entityId,
      label:        entityId,
      relationship: 'owning entity',
      impact_level: 'direct',
    });
    explanation_chain.push('Obligation -> Entity');
  }

  if (assetId) {
    direct_exposure_objects.push({
      object_type:  'asset',
      object_id:    assetId,
      label:        assetId,
      relationship: 'linked asset',
      impact_level: 'direct',
    });
    explanation_chain.push('Obligation -> Asset');
  }

  return {
    linked_risk_sources: [],
    direct_exposure_objects,
    explanation_chain,
  };
}

export interface EntityExposureLinks {
  linked_risk_sources: LinkedRiskSource[];
  direct_exposure_objects: DirectExposureObject[];
  explanation_chain: string[];
}

export function buildEntityExposureLinks(
  entity: { entity_id: string; name?: string; parent_entity_id?: string },
  childObligations: Array<{ obligation_id: string; obligation_type?: string; severity?: string; score_band?: string }>,
  parentEntity: { entity_id: string; name?: string } | null,
  linkedAssets: Array<{ asset_id: string; name?: string }>,
): EntityExposureLinks {
  const linked_risk_sources: LinkedRiskSource[] = [];
  const direct_exposure_objects: DirectExposureObject[] = [];
  const explanation_chain: string[] = [];

  // Risky child obligations → linked_risk_sources
  for (const obl of childObligations) {
    const isRisky = obl.severity === 'high' || obl.severity === 'critical'
      || obl.score_band === 'high' || obl.score_band === 'critical';
    if (isRisky) {
      linked_risk_sources.push({
        object_type:  'obligation',
        object_id:    obl.obligation_id,
        label:        obl.obligation_type || obl.obligation_id,
        relationship: 'child obligation',
      });
    }
  }
  if (childObligations.length > 0) explanation_chain.push('Obligation -> Entity');

  // Linked assets → direct (impact_level: 'direct')
  for (const asset of linkedAssets) {
    direct_exposure_objects.push({
      object_type:  'asset',
      object_id:    asset.asset_id,
      label:        asset.name || asset.asset_id,
      relationship: 'owned asset',
      impact_level: 'direct',
    });
    if (!explanation_chain.includes('Obligation -> Entity -> Asset')) {
      explanation_chain.push('Obligation -> Entity -> Asset');
    }
  }

  // Parent entity → downstream
  if (entity.parent_entity_id && parentEntity) {
    direct_exposure_objects.push({
      object_type:  'entity',
      object_id:    parentEntity.entity_id,
      label:        parentEntity.name || parentEntity.entity_id,
      relationship: 'parent entity',
      impact_level: 'downstream',
    });
    if (!explanation_chain.includes('Obligation -> Entity -> Parent Entity')) {
      explanation_chain.push('Obligation -> Entity -> Parent Entity');
    }
  }

  return { linked_risk_sources, direct_exposure_objects, explanation_chain };
}

export interface AssetExposureLinks {
  linked_risk_sources: LinkedRiskSource[];
  direct_exposure_objects: DirectExposureObject[];
  explanation_chain: string[];
}

export function buildAssetExposureLinks(
  asset: { asset_id: string; name?: string; entity_id?: string },
  linkedEntity: { entity_id: string; name?: string } | null,
  linkedObligations: Array<{ obligation_id: string; obligation_type?: string }>,
): AssetExposureLinks {
  const linked_risk_sources: LinkedRiskSource[] = [];
  const explanation_chain: string[] = [];

  if (linkedEntity) {
    linked_risk_sources.push({
      object_type:  'entity',
      object_id:    linkedEntity.entity_id,
      label:        linkedEntity.name || linkedEntity.entity_id,
      relationship: 'owning entity',
    });
    explanation_chain.push('Obligation -> Entity -> Asset');
  }

  for (const obl of linkedObligations) {
    linked_risk_sources.push({
      object_type:  'obligation',
      object_id:    obl.obligation_id,
      label:        obl.obligation_type || obl.obligation_id,
      relationship: 'linked obligation',
    });
  }
  if (linkedObligations.length > 0 && !explanation_chain.includes('Obligation -> Asset')) {
    explanation_chain.push('Obligation -> Asset');
  }

  return {
    linked_risk_sources,
    direct_exposure_objects: [],
    explanation_chain,
  };
}
