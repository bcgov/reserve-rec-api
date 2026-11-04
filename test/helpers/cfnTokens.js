'use strict';

// Renders a synthesized CloudFormation value as a string, tokens as ${LogicalId} or ${LogicalId.Attr}.
function renderTokens(value) {
  if (typeof value === 'string') return value;
  if (value.Ref) return `\${${value.Ref}}`;
  if (value['Fn::GetAtt']) return `\${${value['Fn::GetAtt'].join('.')}}`;
  const [separator, parts] = value['Fn::Join'];
  return parts.map(renderTokens).join(separator);
}

module.exports = { renderTokens };
