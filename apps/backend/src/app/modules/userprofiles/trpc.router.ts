import { TRPCError } from '@trpc/server';

import { idSchema } from '../../../../../../libs/common/src';

import { authProcedure, router } from '../../../trpc';
import { UserProfilesController } from './controller';

function getById() {
  return authProcedure.input(idSchema).query(({ input, ctx }) => {
    // SECURITY (M14): this returned any tenant user's full profile row — including their
    // stored `preferences` — to any authenticated caller, viewers included. A profile is
    // the owner's to read; admins and owners manage users through the auth module, which
    // has its own visibility rules.
    if (String(input) !== String(ctx.auth.user_id)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'You can only view your own profile.' });
    }
    return user.getOneById({ tenant_id: ctx.auth.tenant_id, id: input });
  });
}

const user = new UserProfilesController();

export const UserProfilesRouter = router({
  getById: getById(),
});
