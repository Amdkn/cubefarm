# A'Space CubeFarm in Codespaces

Open https://codespaces.new/Amdkn/cubefarm/tree/codespaces/aspace-cloud and create the Codespace. Setup builds the real application, installs Codex, GitHub CLI and Chrome. The office starts automatically on every Codespace start. Open port **4417** in the Ports panel and **keep its visibility Private**: the office includes interactive agent terminals and has no application login.

## Connect agents and projects

In the Codespace terminal:

```bash
node bin/cubefarm.js login       # Claude Code / CEO authentication
codex login --device-auth       # optional Codex developers
node bin/cubefarm.js doctor     # check credentials and dependencies
```

Complete provider authentication in your browser. Never paste credentials into issues, chat, or tracked files. Claude is required for the existing CEO implementation; Codex is selectable for developer sessions. Hermes and Jules are not implemented by this upstream application.

Open the office, complete its manager setup and connect `Amdkn/Aspace_OS-V4` as a project. If GitHub denies access, grant that repository to this Codespace's GitHub authorization before starting work; this fork's token does not imply access to every repository. Select the agent CLI, staffing and auto-assign policy in the office. Login alone does not start a mission.

## Operations and persistence

```bash
bash .devcontainer/office.sh status
bash .devcontainer/office.sh stop
bash .devcontainer/office.sh start
```

`/workspaces/.aspace-cubefarm` holds state, project clones/worktrees and `office.log`, outside the application checkout. It survives stop/start and rebuild of the same Codespace, **not deletion of that Codespace**. Provider credentials may need reauthentication after a rebuild. Do not commit state or credentials. Stopping the office is not a guarantee that independently retained agent terminals are stopped; stop active sessions in the UI first.

For another Docker host/VPS, reopen this repository with the same devcontainer and mount a persistent `/workspaces` volume. Stop sessions and the office before transferring its private state directory through a secure channel; restore at the same path and reauthenticate providers. This defines a portable environment, not an automatic live migration. Keep the port behind authenticated access. Codespaces suspends when stopped or idle; it is not a permanent background worker service.

## Isolated smoke check (no provider usage)

```bash
SWARM_HOME="$(mktemp -d)" SWARM_PORT=4497 SWARM_DEMO=1 bash .devcontainer/office.sh start
```

Use the same temporary `SWARM_HOME` to stop it afterward. Production uses real mode by default. The launcher deliberately runs built artifacts directly, without the upstream launcher's automatic source updates.
