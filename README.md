# Webapp

A responsive clinical web application for the Cloud Health Project. It gives healthcare staff a patient-centered interface for appointments, diagnostics, health metrics, and private medical files.

## About

This project is part of the Cloud Health Project for ITS 2130 Enterprise Cloud Architecture. The browser calls same-origin `/api` paths, and the Node.js server proxies them to the API Gateway to keep backend routing and CORS concerns out of the UI.

## Tech Stack

| Technology | Details |
|---|---|
| Node.js | 22 or newer |
| HTML5 | Semantic application structure |
| CSS3 | Responsive clinical interface |
| JavaScript modules | Browser workflows and API client |
| Node HTTP server | Static hosting and gateway proxy |
| Docker | Production container |
| Cloud Build | Image build and deployment |
| Cloud Run | Managed webapp runtime |

## Features

| View | Purpose |
|---|---|
| Overview | Patient context, service status, and workflow summary |
| Patients | Search and register patient profiles |
| Appointments | Schedule visits and update lifecycle status |
| Diagnostics | Create, finalize, and amend diagnostic records |
| Health Metrics | Record dynamic longitudinal measurements |
| Medical Files | Upload, download, and delete private clinical files |

## Application Details

| Property | Value |
|---|---|
| Local port | `3000` |
| Cloud Run port | `8080` |
| Package | `cloud-health-portal` |
| Gateway variable | `API_GATEWAY_URL` |
| Health endpoint | `/healthz` |
| Repository | `Cloud-Health-Project-Webapp` |

## Getting Started

> **Prerequisite:** Config-Server, Discovery-Server, Api-Gateway, and all three domain services must be running.

Full startup order:

1. Config Server (`8888`)
2. Discovery Server (`8761`)
3. API Gateway (`8080`)
4. Patient Service (`8081`)
5. Diagnostics Service (`8082`)
6. File Service (`8083`)
7. **Webapp** (`3000`)

```bash
API_GATEWAY_URL=http://localhost:8080 npm start
```

Open `http://localhost:3000`. No dependency installation is required because the webapp uses Node.js built-ins and browser APIs.

## Testing

```bash
npm run check
npm test
```

## Container

```bash
docker build -t cloud-health-portal .
docker run --rm -p 3000:8080 \
  -e PORT=8080 \
  -e API_GATEWAY_URL=http://host.docker.internal:8080 \
  cloud-health-portal
```

The container runs as the unprivileged `node` user.

## Cloud Run Deployment

After the API load balancer is available, submit the included build configuration:

```bash
gcloud builds submit \
  --region=asia-south1 \
  --config=cloudbuild.yaml \
  --substitutions=_API_GATEWAY_URL=http://YOUR_LOAD_BALANCER_IP
```

The frontend stores no credentials, patient records, or uploaded files on local disk.

## Project Details

| Property | Value |
|---|---|
| Student | Hiruna Dissanayake |
| Student number | `241711024` |
| GCP project | `cloud-health-506015-hiruna` |
