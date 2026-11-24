import { EntityPage, type EntityConfig } from './EntityPage';

const cfg: EntityConfig = {
  table: 'suppliers', folder: 'suppliers', imageKey: 'logo_path', imageLabel: 'f.logo',
  fields: [
    { key: 'industry', label: 'f.industry', kind: 'text' },
    { key: 'location', label: 'f.location', kind: 'text' },
    { key: 'description', label: 'f.description', kind: 'textarea' },
  ],
  subtitleKeys: ['industry', 'location'],
  text: { add: 'ent.sup.add', new: 'ent.sup.new', none: 'ent.sup.none', deleteTitle: 'ent.sup.deleteTitle', deleteBody: 'ent.sup.deleteBody' },
};
export const Suppliers = () => <EntityPage cfg={cfg} />;
