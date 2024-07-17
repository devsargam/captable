import { generatePublicId } from "@/common/id";
import { createApiToken, createSecureHash } from "@/lib/crypto";
import { Audit } from "@/server/audit";
import { createTRPCRouter, withAuth } from "@/trpc/api/trpc";
import { TRPCError } from "@trpc/server";
import z from "zod";

export const apiKeyRouter = createTRPCRouter({
  create: withAuth.mutation(async ({ ctx }) => {
    const { db, session, userAgent, requestIp } = ctx;
    const user = session.user;

    const data = await db.$transaction(async (tx) => {
      const token = await createApiToken();
      const keyId = generatePublicId();
      const hashedToken = await createSecureHash(token);

      const key = await tx.apiKey.create({
        data: {
          keyId,
          userId: user.id,
          hashedToken,
        },
      });

      await Audit.create(
        {
          action: "apiKey.created",
          companyId: user.companyId,
          actor: { type: "user", id: user.id },
          context: {
            userAgent,
            requestIp,
          },
          target: [{ type: "apiKey", id: key.id }],
          summary: `${user.name} created the apiKey ${key.name}`,
        },
        tx,
      );

      return {
        token,
        keyId: key.keyId,
        createdAt: key.createdAt,
      };
    });

    return data;
  }),

  delete: withAuth
    .input(z.object({ keyId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const { db, session, userAgent, requestIp } = ctx;
        const { user } = session;
        const { keyId } = input;

        await db.$transaction(async (tx) => {
          const key = await tx.apiKey.delete({
            where: {
              keyId,
            },
          });
          await Audit.create(
            {
              action: "apiKey.deleted",
              companyId: user.companyId,
              actor: { type: "user", id: session.user.id },
              context: {
                userAgent,
                requestIp,
              },
              target: [{ type: "apiKey", id: key.id }],
              summary: `${user.name} deleted the apiKey ${key.name}`,
            },
            tx,
          );
        });

        return {
          success: true,
          message: "Key deleted Successfully.",
        };
      } catch (error) {
        console.error("Error deleting the api key :", error);
        if (error instanceof TRPCError) {
          return {
            success: false,
            message: error.message,
          };
        }
        return {
          success: false,
          message: "Oops, something went wrong. Please try again later.",
        };
      }
    }),
});
