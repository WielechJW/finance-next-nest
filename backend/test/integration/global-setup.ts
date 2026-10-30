import { configureTestDatabase } from './database.js';
import { prepareTestDatabase } from '../support/database.js';

export default async function setup(): Promise<void> {
  await prepareTestDatabase(configureTestDatabase());
}
