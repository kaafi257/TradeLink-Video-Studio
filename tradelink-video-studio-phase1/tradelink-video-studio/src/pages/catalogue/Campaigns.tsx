import { CAMPAIGN_TYPES } from '../../lib/catalogue';
import type { MessageKey } from '../../i18n/en';
import { EntityPage, type EntityConfig } from './EntityPage';

const cfg: EntityConfig = {
  table: 'campaigns', folder: 'campaigns', imageKey: 'banner_path', imageLabel: 'f.banner', linkProducts: true,
  fields: [
    { key: 'campaign_type', label: 'f.type', kind: 'select', required: true, options: CAMPAIGN_TYPES.map((c) => ({ value: c, label: `ctype.${c}` as MessageKey })) },
    { key: 'description', label: 'f.description', kind: 'textarea' },
    { key: 'starts_on', label: 'f.starts', kind: 'date' },
    { key: 'ends_on', label: 'f.ends', kind: 'date' },
  ],
  subtitleKeys: ['campaign_type', 'starts_on', 'ends_on'],
  text: { add: 'ent.camp.add', new: 'ent.camp.new', none: 'ent.camp.none', deleteTitle: 'ent.camp.deleteTitle', deleteBody: 'ent.camp.deleteBody' },
};
export const Campaigns = () => <EntityPage cfg={cfg} />;
