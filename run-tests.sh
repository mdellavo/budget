#!/bin/bash
./venv/bin/pytest && cd frontend && npm test --exit && cd .. && pre-commit run --all-files
