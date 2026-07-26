import axios from "axios";

const API_BASE_URL = "http://127.0.0.1:8000";
const API_REQUEST_TIMEOUT_MS = 5_000;

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: API_REQUEST_TIMEOUT_MS,
});
