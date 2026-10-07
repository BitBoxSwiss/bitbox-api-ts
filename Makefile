# SPDX-License-Identifier: Apache-2.0

FIRMWARE_MESSAGES := ../bitbox02-firmware/messages
MESSAGES_DIR      := messages
GEN_DIR           := src/proto/gen
API_REFERENCE_DTS := ../bitbox-api-rs/pkg/bitbox_api.d.ts
API_FIXTURE_DTS   := test/fixtures/bitbox_api.d.ts

.PHONY: install typecheck lint test test-sim build ci sandbox-dev sandbox-typecheck sandbox-build proto-sync proto-gen proto-reset api-fixture-update

install:
	npm ci
typecheck:
	npm run typecheck
lint:
	npm run lint
test:
	npm test
test-sim:
	npm run test:sim
build:
	npm run build
ci:
	./ci.sh

sandbox-dev:
	npm run sandbox:dev
sandbox-typecheck:
	npm run sandbox:typecheck
sandbox-build:
	npm run sandbox:build

proto-sync:
	cp $(FIRMWARE_MESSAGES)/*.proto $(MESSAGES_DIR)/
proto-gen:
	npm run proto:gen
proto-reset:
	rm -f $(MESSAGES_DIR)/*.proto
	rm -rf $(GEN_DIR)
	mkdir -p $(GEN_DIR)
	$(MAKE) proto-sync
	$(MAKE) proto-gen

api-fixture-update:
	test -f $(API_REFERENCE_DTS)
	mkdir -p $(dir $(API_FIXTURE_DTS))
	cp $(API_REFERENCE_DTS) $(API_FIXTURE_DTS)
