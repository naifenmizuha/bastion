import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolvePrincipalContext } from "./runtime-host.ts";

describe("runtime principal context", () => {
  it("uses a supplied principal instead of environment identity", () => {
    assert.deepEqual(
      resolvePrincipalContext(
        {
          authorityId: "authority-option",
          teamId: "team-option",
          userId: "user-option",
          role: "coach",
          playerId: "player-option",
        },
        {
          BASTION_AUTHORITY_ID: "authority-env",
          BASTION_TEAM_ID: "team-env",
          BASTION_USER_ID: "user-env",
          BASTION_USER_ROLE: "player",
        },
      ),
      {
        authorityId: "authority-option",
        teamId: "team-option",
        userId: "user-option",
        role: "coach",
        playerId: "player-option",
      },
    );
  });

  it("loads a principal from environment configuration", () => {
    assert.deepEqual(
      resolvePrincipalContext(undefined, {
        BASTION_AUTHORITY_ID: "authority-one",
        BASTION_TEAM_ID: "team-one",
        BASTION_USER_ID: "user-one",
        BASTION_USER_ROLE: "player",
        BASTION_PLAYER_ID: "player-one",
      }),
      {
        authorityId: "authority-one",
        teamId: "team-one",
        userId: "user-one",
        role: "player",
        playerId: "player-one",
      },
    );
  });

  it("fails closed for missing or invalid identity", () => {
    assert.throws(
      () => resolvePrincipalContext(undefined, {}),
      /BASTION_USER_ROLE/,
    );
    assert.throws(
      () => resolvePrincipalContext(undefined, {
        BASTION_AUTHORITY_ID: "authority-one",
        BASTION_TEAM_ID: "team-one",
        BASTION_USER_ID: "user with spaces",
        BASTION_USER_ROLE: "admin",
      }),
      /BASTION_USER_ID/,
    );
  });
});
