import mongoose from 'mongoose';
import './models';

/** Builds every model's indexes (and drops ones no longer declared). Used by tests and Day 20's script. */
export async function syncAllIndexes() {
  for (const model of Object.values(mongoose.models)) {
    await model.syncIndexes();
  }
}

export async function diffAllIndexes() {
  for (const model of Object.values(mongoose.models)) {
    console.log(model.modelName, await model.diffIndexes());
  }
}
