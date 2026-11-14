# Single-container build: front-end compiled with Node, served by the FastAPI backend.
FROM node:22-alpine AS web
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim
WORKDIR /app
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY backend/ backend/
COPY data/ data/
COPY --from=web /app/frontend/dist frontend/dist
WORKDIR /app/backend
RUN python -m flameatlas.etl.build --no-processed
ENV PORT=8000
CMD ["sh", "-c", "uvicorn flameatlas.api.main:app --host 0.0.0.0 --port ${PORT}"]
