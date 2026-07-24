import { BaseRepository } from '../../../lib/base.repo';

export class BugReportsRepo extends BaseRepository<'bug_reports'> {
  constructor() {
    super('bug_reports');
  }
}
