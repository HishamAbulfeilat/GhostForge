# /docker-gen

> Generate Dockerfile and Docker Compose templates for Next.js, Node.js, and React Vite projects.

## Usage
```bash
bash scripts/docker-gen.sh <command> [options]
```

## Commands
| Command | Description |
|---|---|
| `generate [type]` | Create a Dockerfile (`nextjs`, `node`, or `react-vite`) |
| `compose` | Generate `docker-compose.yml` with app plus optional Postgres/Redis profiles |
| `dev` | Generate `docker-compose.dev.yml` for local hot reload |
| `clean` | Remove generated Docker assets |
| `help` | Show help |

## Example
```bash
bash scripts/docker-gen.sh generate nextjs
```
