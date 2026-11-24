import { EntityPage, type EntityConfig } from './EntityPage';

const cfg: EntityConfig = {
  table: 'categories', folder: 'categories', imageKey: 'image_path', imageLabel: 'f.image',
  fields: [{ key: 'description', label: 'f.description', kind: 'textarea' }],
  subtitleKeys: ['description'],
  text: { add: 'ent.cat.add', new: 'ent.cat.new', none: 'ent.cat.none', deleteTitle: 'ent.cat.deleteTitle', deleteBody: 'ent.cat.deleteBody' },
};
export const Categories = () => <EntityPage cfg={cfg} />;
