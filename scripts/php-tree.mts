// The PHP that writes the typed tree of a value, which the contract and the fuzz compare with the tree of each port:
// references and objects are numbered by first appearance, and bytes are base64.
export const PHP_TREE = String.raw`function tree(mixed $value, array &$state): array {
    if (($state['limit'] ?? PHP_INT_MAX) < ($state['nodes'] = ($state['nodes'] ?? 0) + 1)) throw new OverflowException('the tree exceeds its limit');
    if ($value === null) return ['null'];
    if (is_bool($value)) return ['bool', $value];
    if (is_int($value)) return ['int', (string) $value];
    if (is_float($value)) return ['float', is_nan($value) ? 'nan' : bin2hex(pack('E', $value))];
    if (is_string($value)) return ['string', base64_encode($value)];
    if (is_object($value)) {
        $id = spl_object_id($value);
        if (isset($state['objects'][$id])) return ['object', $state['objects'][$id]];
        $ordinal = count($state['objects']);
        $state['objects'][$id] = $ordinal;
        if (get_class($value) !== 'stdClass') $state['foreign'] = true;
        $pairs = [];
        $array = (array) $value;
        foreach (array_keys($array) as $key) $pairs[] = [base64_encode((string) $key), element($array, $key, $state)];
        return ['object', $ordinal, get_class($value), $pairs];
    }
    $pairs = [];
    foreach (array_keys($value) as $key) {
        $pairs[] = [is_int($key) ? ['int', (string) $key] : ['string', base64_encode($key)], element($value, $key, $state)];
    }
    return ['array', $pairs];
}

function element(array &$array, int|string $key, array &$state): array {
    $reference = ReflectionReference::fromArrayElement($array, $key);
    if ($reference === null) return tree($array[$key], $state);
    $id = $reference->getId();
    if (isset($state['references'][$id])) return ['ref', $state['references'][$id]];
    $ordinal = count($state['references']);
    $state['references'][$id] = $ordinal;
    return ['ref', $ordinal, tree($array[$key], $state)];
}
`;
