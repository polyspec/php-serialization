<?php

declare(strict_types=1);

namespace Polyspec\PhpSerialization\Tests;

use PHPUnit\Framework\TestCase;
use Polyspec\PhpSerialization as P;

/**
 * The contract cases of php-serialization run with the extension loaded. PHP_SERIALIZATION_CONTRACTS is the path of
 * contracts/, which make test-php sets. A value of the cases is {"kind", "value"} (binding G-5,
 * docs/spec/php-serialize.md); its PHP value is the one that PHP itself reads from the bytes of the case, so the
 * runner compares the result of the extension with PHP: the bytes that PHP writes for it, and those that the
 * extension writes. A reference of the cases is a PHP reference at each place of its id, and an object with an id is
 * the same PHP object at each place of its id, which a later place names by its id alone; n nested objects are one
 * object with repeat (binding G-5). A top value that is a
 * reference has no PHP form, since PHP passes a value and not a reference, and neither has a reference that holds a
 * reference or an integer outside 64 bits; the runner runs every other case first and then fails, naming each such
 * case (RQ-015). A case that arms fault injection points
 * runs armed: the runner makes the value first, arms the faults for the member with Internal\armFaults, the entry point
 * of the feature fault-test (binding GN-5, GN-8a), calls the member at once and requires Internal\faultLeft to be
 * empty after the expected failure. A case that raises expects the class that binding GN-7a gives its kind: the error
 * unit that the row of the kind in packages/rust/interface.json names, else the class of its category.
 */
final class CasesTest extends TestCase
{
    /** @return array<string, mixed> */
    private static function read(string $name): array
    {
        $path = getenv('PHP_SERIALIZATION_CONTRACTS');
        self::assertIsString($path);
        $cases = json_decode((string) file_get_contents($path . '/' . $name), true, 512, JSON_THROW_ON_ERROR | JSON_BIGINT_AS_STRING);
        self::assertIsArray($cases);
        return $cases;
    }

    private static function key(mixed $key): int|string
    {
        if (is_string($key)) {
            return $key;
        }
        if (isset($key['int'])) {
            return (int) $key['int'];
        }
        return (string) hex2bin($key['hex']);
    }

    /**
     * The PHP value of a value of the cases. An array or an object holds a reference of the cases as a PHP reference
     * to the cell of its id, so every place of one id shares it; an object is made from the array of its properties,
     * because a property name may start with NUL (RQ-009), which PHP takes from an array and not from a property
     * access.
     *
     * @param array<string, mixed> $value
     * @param array<int|string, mixed> $cells
     */
    private static function fromCase(array $value, array &$cells): mixed
    {
        if (isset($value['host'])) {
            return match ($value['host']) {
                'callable' => static fn (): null => null,
                'date' => new \DateTimeImmutable('@0'),
                'object' => new \ArrayObject(),
            };
        }
        switch ($value['kind']) {
            case 'null':
                return null;
            case 'bool':
                return $value['value'];
            case 'int':
                return is_string($value['value']) ? self::integer($value['value']) : $value['value'];
            case 'float':
                $raw = $value['value'];
                return is_array($raw) ? ['nan' => NAN, 'inf' => INF, '-inf' => -INF][$raw['float']] : (float) $raw;
            case 'bytes':
                return (string) hex2bin($value['value']['hex']);
            case 'text':
                return $value['value'];
            case 'list':
                // A list nested deeper than a JSON reader takes is {"kind": "list", "repeat": n, "value"} (binding G-5).
                if (isset($value['repeat'])) {
                    $made = self::fromCase($value['value'], $cells);
                    for ($i = 0; $i < $value['repeat']; $i++) {
                        $made = [$made];
                    }
                    return $made;
                }
                $items = [];
                foreach ($value['value'] as $item) {
                    $items[] = self::fromCase($item, $cells);
                }
                return $items;
            case 'object':
                if (!isset($value['value'])) {
                    $object = $cells['object ' . $value['id']] ?? null;
                    if (!is_object($object)) {
                        self::fail('the object ' . $value['id'] . ' has no first place');
                    }
                    return $object;
                }
                if (isset($value['repeat'])) {
                    $made = self::fromCase($value['value'], $cells);
                    for ($i = 0; $i < $value['repeat']; $i++) {
                        $made = (object) [self::key($value['key']) => $made];
                    }
                    return $made;
                }
                $object = self::fromCase(['kind' => 'map', 'value' => $value['value']], $cells);
                $object = (object) $object;
                if (isset($value['id'])) {
                    $cells['object ' . $value['id']] = $object;
                }
                return $object;
            case 'map':
                $array = [];
                foreach ($value['value'] as [$key, $item]) {
                    if (($item['kind'] ?? null) === 'reference') {
                        $array[self::key($key)] = &self::cell($item, $cells);
                    } else {
                        $array[self::key($key)] = self::fromCase($item, $cells);
                    }
                }
                return $array;
        }
        throw new \UnexpectedValueException('a value of the kind ' . $value['kind'] . ' has no PHP form as a top value');
    }

    /**
     * The cell of a reference of the cases, made at its first place. A reference that holds a reference has no PHP
     * form, since PHP binds the two places to one value, and the runner fails on it.
     *
     * @param array<string, mixed> $item
     * @param array<int, mixed> $cells
     */
    private static function &cell(array $item, array &$cells): mixed
    {
        $id = $item['value']['id'];
        if (!array_key_exists($id, $cells)) {
            if (($item['value']['value']['kind'] ?? null) === 'reference') {
                throw new \UnexpectedValueException('a reference that holds a reference has no PHP form');
            }
            $cells[$id] = null;
            $cells[$id] = self::fromCase($item['value']['value'], $cells);
        }
        return $cells[$id];
    }

    // An integer of the cases outside the safe integers of JavaScript is its decimal text. One outside 64 bits, which
    // the cases of int_range give, has no PHP form, since PHP has no such integer, and the runner fails on it.
    private static function integer(string $text): int
    {
        $int = filter_var($text, FILTER_VALIDATE_INT);
        if ($int === false) {
            throw new \UnexpectedValueException('the integer ' . $text . ' has no PHP form');
        }
        return $int;
    }

    /**
     * The class of an error of the kind (binding GN-7a): the error unit that the row of the kind in errors.kinds of
     * packages/rust/interface.json names in class, a class of the namespace of the root, else the class of its
     * category. The kind of a row is the snake_case of the last segment of its variant (binding CK-22).
     */
    private static function errorClass(string $kind, string $category): string
    {
        $path = getenv('PHP_SERIALIZATION_CONTRACTS');
        self::assertIsString($path);
        $interface = json_decode((string) file_get_contents($path . '/../packages/rust/interface.json'), true, 512, JSON_THROW_ON_ERROR);
        self::assertIsArray($interface);
        foreach ($interface['errors']['kinds'] as $row) {
            $parts = explode('::', $row['variant']);
            $last = end($parts);
            if (strtolower((string) preg_replace('/(?<!^)(?=[A-Z])/', '_', $last)) !== $kind) {
                continue;
            }
            if (!isset($row['class'])) {
                break;
            }
            foreach ($interface['units'] as $unit) {
                if ($unit['id'] === $row['class']) {
                    return 'Polyspec\\PhpSerialization\\' . implode('', array_map(ucfirst(...), $unit['name']));
                }
            }
            self::fail('no unit ' . $row['class']);
        }
        return $interface['errors']['classes'][$category]['php'];
    }

    /** @param array<string, mixed> $case */
    private static function raises(array $case, callable $call): void
    {
        $raises = $case['raises'];
        try {
            $call();
        } catch (\Throwable $error) {
            self::assertSame(self::errorClass($raises['kind'], $raises['category']), $error::class, $case['id'] . ': ' . $error->getMessage());
            self::assertSame($raises['kind'], $error->kind(), $case['id']);
            self::assertSame($raises['status'], $error->status(), $case['id']);
            if ($raises['message'] !== null) {
                self::assertSame($raises['message'], $error->getMessage(), $case['id']);
            }
            return;
        }
        self::fail('no error: ' . $case['id']);
    }

    public function testUnserialize(): void
    {
        $php = self::read('php-serialize.json');
        $count = 0;
        foreach (['cases', 'forms', 'deep', 'rejected', 'stricter'] as $group) {
            self::assertNotEmpty($php[$group], $group);
            foreach ($php[$group] as $case) {
                $count++;
                $data = (string) hex2bin($case['data']['hex']);
                if (isset($case['raises'])) {
                    self::raises($case, static fn (): mixed => P\unserialize($data));
                    continue;
                }
                $result = P\unserialize($data);
                $written = $case['written'] ?? $case['bytes'];
                self::assertSame($written, base64_encode(\serialize($result)), $case['id']);
                self::assertSame($written, base64_encode(P\serialize($result)), $case['id']);
            }
        }
        self::assertGreaterThan(0, $count);
    }

    public function testSerialize(): void
    {
        $php = self::read('php-serialize.json');
        $host = self::read('host-values.json');
        $count = 0;
        $noForm = [];
        foreach ([...$php['cases'], ...$php['forms'], ...$php['refused_values'], ...$host['serialize'], ...$host['php_value']] as $case) {
            if (!isset($case['value'])) {
                continue;
            }
            $count++;
            $cells = [];
            try {
                $value = self::fromCase($case['value'], $cells);
            } catch (\UnexpectedValueException $error) {
                $noForm[] = $case['id'] . ': ' . $error->getMessage();
                continue;
            }
            if (isset($case['faults'])) {
                $armed = P\Internal\armFaults('serialize', json_encode($case['faults'], JSON_THROW_ON_ERROR));
                self::raises($case, static fn (): string => P\serialize($value));
                self::assertSame([], P\Internal\faultLeft($armed), $case['id']);
                continue;
            }
            if (isset($case['raises'])) {
                self::raises($case, static fn (): string => P\serialize($value));
                continue;
            }
            $written = P\serialize($value);
            $expected = $case['written'] ?? $case['bytes'] ?? null;
            if ($expected !== null) {
                self::assertSame($expected, base64_encode($written), $case['id']);
            }
            self::assertSame(\serialize($value), $written, $case['id']);
        }
        self::assertGreaterThan(0, $count);
        // RQ-015: every other case ran first; a case whose value has no PHP form fails here and is not skipped.
        self::assertSame([], $noForm, 'the cases whose value has no PHP form (RQ-015)');
    }
}
