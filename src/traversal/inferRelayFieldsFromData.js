/**
 * Copyright 2013-2015, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 *
 * @providesModule inferRelayFieldsFromData
 * @typechecks
 * @flow
 */

'use strict';

const GraphQLStoreDataHandler = require('GraphQLStoreDataHandler');
const RelayConnectionInterface = require('RelayConnectionInterface');
const RelayNodeInterface = require('RelayNodeInterface');
const RelayQuery = require('RelayQuery');

const forEachObject = require('forEachObject');
const invariant = require('invariant');
const warning = require('warning');

const ARGUMENTS = /^(\w+)(?:\((.+?)\))?$/;
const ARGUMENT_NAME = /(\w+)(?=\s*:)/;
const DEPRECATED_CALLS = /^\w+(?:\.\w+\(.*?\))+$/;
const DEPRECATED_CALL = /^(\w+)\((.*?)\)$/;
const {NODE, EDGES} = RelayConnectionInterface;
const {ID, NODE_TYPE} = RelayNodeInterface;

/**
 * @internal
 *
 * Given a record-like object, infers fields that could be used to fetch them.
 * Properties that are fetched via fields with arguments can be encoded by
 * serializing the arguments in property keys.
 */
function inferRelayFieldsFromData(
  data: Object
): Array<RelayQuery.Field> {
  const fields = [];
  forEachObject(data, (value, key) => {
    if (!GraphQLStoreDataHandler.isMetadataKey(key)) {
      fields.push(inferField(value, key));
    }
  });
  return fields;
}

function inferField(value: mixed, key: string): RelayQuery.Field {
  let children;
  let metadata;
  if (Array.isArray(value)) {
    const element = value[0];
    if (element && typeof element === 'object') {
      children = inferRelayFieldsFromData(element);
    } else {
      children = [];
    }
    metadata = {plural: true};
  } else if (typeof value === 'object' && value !== null) {
    children = inferRelayFieldsFromData(value);
  } else {
    children = [];
  }
  if (key === NODE) {
    children.push(RelayQuery.Field.build('id', null, null, {
      parentType: NODE_TYPE,
    }));
  } else if (key === EDGES) {
    children.push(RelayQuery.Field.build('cursor'));
  } else if (key === ID) {
    metadata = {
      parentType: NODE_TYPE,
    };
  }
  return buildField(key, children, metadata);
}

function buildField(
  key: string,
  children: Array<RelayQuery.Field>,
  metadata: ?{[key: string]: mixed}
): RelayQuery.Field {
  let fieldName = key;
  let calls = null;
  if (DEPRECATED_CALLS.test(key)) {
    warning(
      false,
      'inferRelayFieldsFromData(): Encountered an optimistic payload with ' +
      'a deprecated field call string, `%s`. Use valid GraphQL OSS syntax.',
      key
    );
    const parts = key.split('.');
    if (parts.length > 1) {
      fieldName = parts.shift();
      calls = parts.map(callString => {
        const captures = callString.match(DEPRECATED_CALL);
        invariant(
          captures,
          'inferRelayFieldsFromData(): Malformed data key, `%s`.',
          key
        );
        const value = captures[2].split(',');
        return {
          name: captures[1],
          value: value.length === 1 ? value[0] : value,
        };
      });
    }
  } else {
    const captures = key.match(ARGUMENTS);
    invariant(
      captures,
      'inferRelayFieldsFromData(): Malformed data key, `%s`.',
      key
    );
    fieldName = captures[1];
    if (captures[2]) {
      try {
        // Relay does not currently have a GraphQL argument parser, so...
        const args = JSON.parse(
          '{' + captures[2].replace(ARGUMENT_NAME, '"$1"') + '}'
        );
        calls = Object.keys(args).map(name => ({name, value: args[name]}));
      } catch (error) {
        invariant(
          false,
          'inferRelayFieldsFromData(): Malformed or unsupported data key, ' +
          '`%s`. Only booleans, strings, and numbers are currenly supported, ' +
          'and commas are required. Parse failure reason was `%s`.',
          key,
          error.message
        );
      }
    }
  }
  return RelayQuery.Field.build(
    fieldName,
    calls,
    children,
    metadata
  );
}

module.exports = inferRelayFieldsFromData;
