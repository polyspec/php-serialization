// The contract cases of php-serialization, run against the Go binding. PHP_SERIALIZATION_CONTRACTS is the path of
// contracts/, which make test-go sets.
//
// A value of the cases is {"kind", "value"} (binding G-5, docs/spec/php-serialize.md). The runner compares a value in
// one canonical form on both sides, the texts of its places in pre-order, as packages/ts/tests/cases.mjs does: a key is
// {"int": <decimal>} or {"hex": <bytes>}, an integer its decimal text, a float its shortest text with -0 kept, bytes and
// texts their hex, a list the map of its items under the keys 0 to n-1, and a reference and an object numbered by their
// first place, which give their number alone at every later place. A case names a reference or an object again by its
// id alone, and gives n nested lists or objects as one with repeat (binding G-5). A reference and an object with an id
// are made empty at their first place and filled after, so that a later place inside their own value names them. A case
// that raises expects the type that binding GN-7a gives its kind: the error unit that the row of the kind in
// packages/rust/interface.json names, else the category type of E-7. A case that arms fault injection points runs
// armed: the runner makes the value first, arms the faults for the member (binding GN-5, GN-8a), calls the member at
// once and requires the left faults to be empty after the expected failure. An integer outside 64 bits has no Go form,
// since the in rows of php_value take int64 alone; the generated tests execute those cases, and this runner requires
// that no other case lacks a Go form (RQ-015).
package tests

import (
	"bytes"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	phpserialization "github.com/polyspec/php-serialization/packages/go"
	"github.com/polyspec/php-serialization/packages/go/internal/binding"
)

// errNoForm marks a value of the cases that has no Go form.
var errNoForm = errors.New("no Go form")

// read decodes a file of contracts/ with its numbers as json.Number, so an integer keeps its decimal text.
func read(t *testing.T, name string) map[string]any {
	t.Helper()
	dir := os.Getenv("PHP_SERIALIZATION_CONTRACTS")
	if dir == "" {
		t.Fatal("PHP_SERIALIZATION_CONTRACTS names no folder; make test-go sets it to contracts/")
	}
	data, err := os.ReadFile(filepath.Join(dir, name))
	if err != nil {
		t.Fatal(err)
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	var out map[string]any
	if err := decoder.Decode(&out); err != nil {
		t.Fatalf("%s: %v", name, err)
	}
	return out
}

func group(t *testing.T, file map[string]any, name string) []map[string]any {
	t.Helper()
	items, ok := file[name].([]any)
	if !ok || len(items) == 0 {
		t.Fatalf("the group %s holds no case", name)
	}
	out := make([]map[string]any, 0, len(items))
	for _, item := range items {
		out = append(out, item.(map[string]any))
	}
	return out
}

func fromHex(t *testing.T, text string) []byte {
	t.Helper()
	data, err := hex.DecodeString(text)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func floatText(value float64) string {
	switch {
	case math.IsNaN(value):
		return "nan"
	case math.IsInf(value, 1):
		return "inf"
	case math.IsInf(value, -1):
		return "-inf"
	case value == 0 && math.Signbit(value):
		return "-0"
	}
	return strconv.FormatFloat(value, 'g', -1, 64)
}

// caseFloat is the float64 of a float of the cases: a number, or {"float": "nan" | "inf" | "-inf"}.
func caseFloat(raw any) float64 {
	if special, ok := raw.(map[string]any); ok {
		return map[string]float64{"nan": math.NaN(), "inf": math.Inf(1), "-inf": math.Inf(-1)}[special["float"].(string)]
	}
	value, err := strconv.ParseFloat(fmt.Sprint(raw), 64)
	if err != nil {
		panic(err)
	}
	return value
}

// caseKey is the canonical form of a key of the cases: a text, {"int": n} or {"hex": ...}.
func caseKey(key any) string {
	if text, ok := key.(string); ok {
		return `{"hex":"` + hex.EncodeToString([]byte(text)) + `"}`
	}
	object := key.(map[string]any)
	if integer, ok := object["int"]; ok {
		return `{"int":"` + fmt.Sprint(integer) + `"}`
	}
	return `{"hex":"` + object["hex"].(string) + `"}`
}

func hostKey(key binding.Key) string {
	if integer, ok := key.Int(); ok {
		return `{"int":"` + strconv.FormatInt(integer, 10) + `"}`
	}
	if data, ok := key.Bytes(); ok {
		return `{"hex":"` + hex.EncodeToString(data) + `"}`
	}
	text, _ := key.Text()
	return `{"hex":"` + hex.EncodeToString([]byte(text)) + `"}`
}

type canon struct {
	out        []string
	references map[any]int
	objects    map[any]int
}

func newCanon() *canon { return &canon{references: map[any]int{}, objects: map[any]int{}} }

// fromCaseValue writes the canonical form of a value of the cases.
func (c *canon) fromCaseValue(value map[string]any) {
	switch value["kind"] {
	case "null":
		c.out = append(c.out, "null")
	case "bool":
		c.out = append(c.out, fmt.Sprintf("bool %v", value["value"]))
	case "int":
		c.out = append(c.out, "int "+fmt.Sprint(value["value"]))
	case "float":
		c.out = append(c.out, "float "+floatText(caseFloat(value["value"])))
	case "bytes":
		c.out = append(c.out, "bytes "+value["value"].(map[string]any)["hex"].(string))
	case "text":
		c.out = append(c.out, "bytes "+hex.EncodeToString([]byte(value["value"].(string))))
	case "list":
		if repeat, ok := value["repeat"]; ok {
			count, _ := strconv.Atoi(fmt.Sprint(repeat))
			c.out = append(c.out, "map 1", `key {"int":"0"}`)
			if count > 1 {
				c.fromCaseValue(map[string]any{"kind": "list", "repeat": count - 1, "value": value["value"]})
			} else {
				c.fromCaseValue(value["value"].(map[string]any))
			}
			return
		}
		items := value["value"].([]any)
		c.out = append(c.out, fmt.Sprintf("map %d", len(items)))
		for i, item := range items {
			c.out = append(c.out, fmt.Sprintf(`key {"int":"%d"}`, i))
			c.fromCaseValue(item.(map[string]any))
		}
	case "map":
		c.casePairs("map", value["value"].([]any))
	case "object":
		inner, filled := value["value"]
		if !filled {
			number, ok := c.objects[fmt.Sprint(value["id"])]
			if !ok {
				panic(fmt.Sprintf("the object %v has no first place", value["id"]))
			}
			c.out = append(c.out, fmt.Sprintf("object again %d", number))
			return
		}
		number := len(c.objects)
		if id, ok := value["id"]; ok {
			c.objects[fmt.Sprint(id)] = number
		} else {
			c.objects[fmt.Sprintf("place %d", number)] = number
		}
		if repeat, ok := value["repeat"]; ok {
			count, _ := strconv.Atoi(fmt.Sprint(repeat))
			c.out = append(c.out, fmt.Sprintf("object %d 1", number), "key "+caseKey(value["key"]))
			if count > 1 {
				c.fromCaseValue(map[string]any{"kind": "object", "repeat": count - 1, "key": value["key"], "value": inner})
			} else {
				c.fromCaseValue(inner.(map[string]any))
			}
			return
		}
		c.casePairs(fmt.Sprintf("object %d", number), inner.([]any))
	case "reference":
		held := value["value"].(map[string]any)
		id := fmt.Sprint(held["id"])
		if number, ok := c.references[id]; ok {
			if _, again := held["value"]; again {
				panic(fmt.Sprintf("the reference %s gives its value again", id))
			}
			c.out = append(c.out, fmt.Sprintf("reference again %d", number))
			return
		}
		c.references[id] = len(c.references)
		c.out = append(c.out, fmt.Sprintf("reference %d", c.references[id]))
		c.fromCaseValue(held["value"].(map[string]any))
	default:
		panic(fmt.Sprintf("a value of the kind %v has no form in the cases", value["kind"]))
	}
}

func (c *canon) casePairs(head string, pairs []any) {
	c.out = append(c.out, fmt.Sprintf("%s %d", head, len(pairs)))
	for _, pair := range pairs {
		entry := pair.([]any)
		c.out = append(c.out, "key "+caseKey(entry[0]))
		c.fromCaseValue(entry[1].(map[string]any))
	}
}

// fromHostValue writes the canonical form of a value that the binding gives: the out rows of php_value for go.
func (c *canon) fromHostValue(t *testing.T, value any) {
	switch typed := value.(type) {
	case nil:
		c.out = append(c.out, "null")
	case bool:
		c.out = append(c.out, fmt.Sprintf("bool %v", typed))
	case int64:
		c.out = append(c.out, "int "+strconv.FormatInt(typed, 10))
	case float64:
		c.out = append(c.out, "float "+floatText(typed))
	case string:
		c.out = append(c.out, "bytes "+hex.EncodeToString([]byte(typed)))
	case []byte:
		c.out = append(c.out, "bytes "+hex.EncodeToString(typed))
	case []any:
		c.out = append(c.out, fmt.Sprintf("map %d", len(typed)))
		for i, item := range typed {
			c.out = append(c.out, fmt.Sprintf(`key {"int":"%d"}`, i))
			c.fromHostValue(t, item)
		}
	case *binding.KeyedMap[any]:
		c.hostPairs(t, "map", typed)
	case *binding.StdClass:
		if number, ok := c.objects[typed]; ok {
			c.out = append(c.out, fmt.Sprintf("object again %d", number))
			return
		}
		c.objects[typed] = len(c.objects)
		c.hostPairs(t, fmt.Sprintf("object %d", c.objects[typed]), typed.Properties)
	case *binding.Reference:
		if number, ok := c.references[typed]; ok {
			c.out = append(c.out, fmt.Sprintf("reference again %d", number))
			return
		}
		c.references[typed] = len(c.references)
		c.out = append(c.out, fmt.Sprintf("reference %d", c.references[typed]))
		c.fromHostValue(t, typed.Value)
	default:
		t.Fatalf("the binding gave a value that is no form of php_value: %#v", value)
	}
}

func (c *canon) hostPairs(t *testing.T, head string, pairs *binding.KeyedMap[any]) {
	keys := pairs.Keys()
	c.out = append(c.out, fmt.Sprintf("%s %d", head, len(keys)))
	for _, key := range keys {
		item, _ := pairs.Get(key)
		c.out = append(c.out, "key "+hostKey(key))
		c.fromHostValue(t, item)
	}
}

func canonicalCase(value map[string]any) []string {
	c := newCanon()
	c.fromCaseValue(value)
	return c.out
}

func canonicalHost(t *testing.T, value any) []string {
	c := newCanon()
	c.fromHostValue(t, value)
	return c.out
}

// keyOf is a key of the cases as the binding takes it: an integer, a text, or the bytes that are no text.
func keyOf(t *testing.T, key any) (binding.Key, error) {
	if text, ok := key.(string); ok {
		return phpserialization.TextKey(text), nil
	}
	object := key.(map[string]any)
	if integer, ok := object["int"]; ok {
		value, err := strconv.ParseInt(fmt.Sprint(integer), 10, 64)
		if err != nil {
			return binding.Key{}, errNoForm
		}
		return phpserialization.IntKey(value), nil
	}
	data := fromHex(t, object["hex"].(string))
	if utf8.Valid(data) {
		return phpserialization.TextKey(string(data)), nil
	}
	return phpserialization.BytesKey(data), nil
}

// other is a value of Go that is no value of PHP (docs/spec/php-serialize.md, contracts/host-values.json).
type other struct{}

type builder struct {
	t          *testing.T
	references map[string]*binding.Reference
	objects    map[string]*binding.StdClass
}

func newBuilder(t *testing.T) *builder {
	return &builder{t: t, references: map[string]*binding.Reference{}, objects: map[string]*binding.StdClass{}}
}

func newObject(t *testing.T, properties *binding.KeyedMap[any]) *binding.StdClass {
	object, err := phpserialization.NewStdClass(properties)
	if err != nil {
		t.Fatalf("an empty StdClass: %v", err)
	}
	return object
}

// value is the value of the cases as the binding takes it (RQ-012), or errNoForm.
func (b *builder) value(value map[string]any) (any, error) {
	if host, ok := value["host"]; ok {
		switch host {
		case "callable":
			return func() {}, nil
		case "date":
			return time.Unix(0, 0).UTC(), nil
		case "object":
			return &other{}, nil
		}
		b.t.Fatalf("a host value %v of no form", host)
	}
	switch value["kind"] {
	case "null":
		return nil, nil
	case "bool":
		return value["value"].(bool), nil
	case "int":
		integer, err := strconv.ParseInt(fmt.Sprint(value["value"]), 10, 64)
		if err != nil {
			return nil, errNoForm
		}
		return integer, nil
	case "float":
		return caseFloat(value["value"]), nil
	case "bytes":
		return fromHex(b.t, value["value"].(map[string]any)["hex"].(string)), nil
	case "text":
		return value["value"].(string), nil
	case "list":
		if repeat, ok := value["repeat"]; ok {
			count, _ := strconv.Atoi(fmt.Sprint(repeat))
			made, err := b.value(value["value"].(map[string]any))
			if err != nil {
				return nil, err
			}
			for range count {
				made = []any{made}
			}
			return made, nil
		}
		items := []any{}
		for _, item := range value["value"].([]any) {
			made, err := b.value(item.(map[string]any))
			if err != nil {
				return nil, err
			}
			items = append(items, made)
		}
		return items, nil
	case "map":
		entries := &binding.KeyedMap[any]{}
		if err := b.fill(entries, value["value"].([]any)); err != nil {
			return nil, err
		}
		return entries, nil
	case "object":
		inner, filled := value["value"]
		if !filled {
			object, ok := b.objects[fmt.Sprint(value["id"])]
			if !ok {
				b.t.Fatalf("the object %v has no first place", value["id"])
			}
			return object, nil
		}
		if repeat, ok := value["repeat"]; ok {
			count, _ := strconv.Atoi(fmt.Sprint(repeat))
			key, err := keyOf(b.t, value["key"])
			if err != nil {
				return nil, err
			}
			made, err := b.value(inner.(map[string]any))
			if err != nil {
				return nil, err
			}
			for range count {
				properties := &binding.KeyedMap[any]{}
				properties.Set(key, made)
				made = &binding.StdClass{Properties: properties}
			}
			return made, nil
		}
		object := newObject(b.t, &binding.KeyedMap[any]{})
		if id, ok := value["id"]; ok {
			b.objects[fmt.Sprint(id)] = object
		}
		if err := b.fill(object.Properties, inner.([]any)); err != nil {
			return nil, err
		}
		return object, nil
	case "reference":
		held := value["value"].(map[string]any)
		id := fmt.Sprint(held["id"])
		if reference, ok := b.references[id]; ok {
			return reference, nil
		}
		reference := &binding.Reference{}
		b.references[id] = reference
		made, err := b.value(held["value"].(map[string]any))
		if err != nil {
			return nil, err
		}
		reference.Value = made
		return reference, nil
	}
	b.t.Fatalf("a value of the kind %v has no form in the cases", value["kind"])
	return nil, nil
}

func (b *builder) fill(entries *binding.KeyedMap[any], pairs []any) error {
	for _, pair := range pairs {
		entry := pair.([]any)
		key, err := keyOf(b.t, entry[0])
		if err != nil {
			return err
		}
		made, err := b.value(entry[1].(map[string]any))
		if err != nil {
			return err
		}
		entries.Set(key, made)
	}
	return nil
}

// errorType is the Go type name of an error of the kind (binding GN-7a): the error unit that the row of the kind in
// errors.kinds of packages/rust/interface.json names in class, else the category type of E-7. The kind of a row is the
// snake_case of the last segment of its variant (binding CK-22).
func errorType(t *testing.T, iface map[string]any, kind, category string) string {
	errorsPart := iface["errors"].(map[string]any)
	for _, raw := range errorsPart["kinds"].([]any) {
		row := raw.(map[string]any)
		segments := strings.Split(row["variant"].(string), "::")
		if snake(segments[len(segments)-1]) != kind {
			continue
		}
		class, ok := row["class"]
		if !ok {
			break
		}
		for _, rawUnit := range iface["units"].([]any) {
			unit := rawUnit.(map[string]any)
			if unit["id"] == class {
				name := ""
				for _, word := range unit["name"].([]any) {
					text := word.(string)
					name += strings.ToUpper(text[:1]) + text[1:]
				}
				return name
			}
		}
		t.Fatalf("no unit %v", class)
	}
	return "PHPSerialization" + strings.ToUpper(category[:1]) + category[1:] + "Error"
}

func snake(name string) string {
	var out strings.Builder
	for i, r := range name {
		if i > 0 && r >= 'A' && r <= 'Z' {
			out.WriteByte('_')
		}
		out.WriteRune(r)
	}
	return strings.ToLower(out.String())
}

// coded is the interface of every error type of the binding (E-7).
type coded interface {
	error
	Kind() string
	Status() (int, bool)
}

func raises(t *testing.T, iface map[string]any, kase map[string]any, err error) {
	t.Helper()
	id := kase["id"]
	expected := kase["raises"].(map[string]any)
	if err == nil {
		t.Errorf("%v: no error", id)
		return
	}
	failure, ok := err.(coded)
	if !ok {
		t.Errorf("%v: the error %#v has no kind", id, err)
		return
	}
	name := errorType(t, iface, expected["kind"].(string), expected["category"].(string))
	if got := reflect.TypeOf(err).Elem().Name(); got != name {
		t.Errorf("%v: the error is %s, expected %s: %v", id, got, name, err)
	}
	if failure.Kind() != expected["kind"] {
		t.Errorf("%v: the kind is %s, expected %v", id, failure.Kind(), expected["kind"])
	}
	status, has := failure.Status()
	if want := expected["status"]; want == nil {
		if has {
			t.Errorf("%v: the status is %d, expected none", id, status)
		}
	} else if !has || fmt.Sprint(status) != fmt.Sprint(want) {
		t.Errorf("%v: the status is %d (%v), expected %v", id, status, has, want)
	}
	if message := expected["message"]; message != nil && failure.Error() != message {
		t.Errorf("%v: the message is %q, expected %q", id, failure.Error(), message)
	}
}

func written(kase map[string]any) (string, bool) {
	if text, ok := kase["written"].(string); ok {
		return text, true
	}
	text, ok := kase["bytes"].(string)
	return text, ok
}

func interfaceContract(t *testing.T) map[string]any {
	return read(t, filepath.Join("..", "packages", "rust", "interface.json"))
}

func TestUnserialize(t *testing.T) {
	php := read(t, "php-serialize.json")
	iface := interfaceContract(t)
	count := 0
	for _, name := range []string{"cases", "forms", "deep", "rejected", "stricter"} {
		for _, kase := range group(t, php, name) {
			count++
			data := fromHex(t, kase["data"].(map[string]any)["hex"].(string))
			result, err := phpserialization.Unserialize(data)
			if _, ok := kase["raises"]; ok {
				raises(t, iface, kase, err)
				continue
			}
			if err != nil {
				t.Errorf("%v: %v", kase["id"], err)
				continue
			}
			if value, ok := kase["value"].(map[string]any); ok {
				if got, want := canonicalHost(t, result), canonicalCase(value); !slices.Equal(got, want) {
					t.Errorf("%v: the value is %v, expected %v", kase["id"], got, want)
				}
			}
			again, err := phpserialization.Serialize(result)
			if err != nil {
				t.Errorf("%v: serialize of the result: %v", kase["id"], err)
				continue
			}
			if want, _ := written(kase); base64.StdEncoding.EncodeToString(again) != want {
				t.Errorf("%v: serialize of the result wrote %q, expected %q", kase["id"], base64.StdEncoding.EncodeToString(again), want)
			}
		}
	}
	if count == 0 {
		t.Fatal("no unserialize case ran")
	}
	t.Logf("%d unserialize cases", count)
}

func TestSerialize(t *testing.T) {
	php := read(t, "php-serialize.json")
	host := read(t, "host-values.json")
	iface := interfaceContract(t)
	var cases []map[string]any
	for _, name := range []string{"cases", "forms", "refused_values"} {
		cases = append(cases, group(t, php, name)...)
	}
	for _, name := range []string{"serialize", "php_value"} {
		cases = append(cases, group(t, host, name)...)
	}
	count := 0
	var noForm []string
	for _, kase := range cases {
		value, ok := kase["value"].(map[string]any)
		if !ok {
			continue
		}
		count++
		made, err := newBuilder(t).value(value)
		if errors.Is(err, errNoForm) {
			noForm = append(noForm, kase["id"].(string))
			continue
		}
		if faults, ok := kase["faults"]; ok {
			encoded, _ := json.Marshal(faults)
			left, armErr := armed(t, "serialize", string(encoded), func() error {
				_, err := phpserialization.Serialize(made)
				return err
			}, func(err error) { raises(t, iface, kase, err) })
			if armErr != nil {
				t.Errorf("%v: %v", kase["id"], armErr)
			} else if len(left) != 0 {
				t.Errorf("%v: the faults %v did not fire", kase["id"], left)
			}
			continue
		}
		out, err := phpserialization.Serialize(made)
		if _, ok := kase["raises"]; ok {
			raises(t, iface, kase, err)
			continue
		}
		if err != nil {
			t.Errorf("%v: %v", kase["id"], err)
			continue
		}
		if want, ok := written(kase); ok && base64.StdEncoding.EncodeToString(out) != want {
			t.Errorf("%v: wrote %q, expected %q", kase["id"], base64.StdEncoding.EncodeToString(out), want)
		}
		back, err := phpserialization.Unserialize(out)
		if err != nil {
			t.Errorf("%v: unserialize of the written bytes: %v", kase["id"], err)
			continue
		}
		if got, want := canonicalHost(t, back), canonicalCase(value); !slices.Equal(got, want) {
			t.Errorf("%v: the value read back is %v, expected %v", kase["id"], got, want)
		}
	}
	if count == 0 {
		t.Fatal("no serialize case ran")
	}
	// RQ-015: the generated tests execute exactly these two; every other case runs above.
	if want := []string{"an_integer_above_64_bits_is_refused", "an_integer_below_64_bits_is_refused"}; !slices.Equal(noForm, want) {
		t.Errorf("the cases whose value has no Go form (RQ-015) are %v, expected %v", noForm, want)
	}
	t.Logf("%d serialize cases, %d without a Go form", count, len(noForm))
}

func TestStdClass(t *testing.T) {
	host := read(t, "host-values.json")
	iface := interfaceContract(t)
	count := 0
	for _, kase := range append(group(t, host, "std_class.constructor"), group(t, host, "std_class.properties")...) {
		count++
		properties := &binding.KeyedMap[any]{}
		if err := newBuilder(t).fill(properties, kase["properties"].([]any)); err != nil {
			t.Fatalf("%v: %v", kase["id"], err)
		}
		object, err := phpserialization.NewStdClass(properties)
		if _, ok := kase["raises"]; ok {
			raises(t, iface, kase, err)
			continue
		}
		if err != nil {
			t.Errorf("%v: %v", kase["id"], err)
			continue
		}
		if got, want := canonicalHost(t, object), canonicalCase(map[string]any{"kind": "object", "value": kase["properties"]}); !slices.Equal(got, want) {
			t.Errorf("%v: the object is %v, expected %v", kase["id"], got, want)
		}
	}
	t.Logf("%d StdClass cases", count)
}

func TestReference(t *testing.T) {
	host := read(t, "host-values.json")
	iface := interfaceContract(t)
	count := 0
	for _, kase := range append(group(t, host, "reference.constructor"), group(t, host, "reference.value")...) {
		count++
		value := kase["value"].(map[string]any)
		made, err := newBuilder(t).value(value)
		if err != nil {
			t.Fatalf("%v: %v", kase["id"], err)
		}
		reference, err := phpserialization.NewReference(made)
		if _, ok := kase["raises"]; ok {
			raises(t, iface, kase, err)
			continue
		}
		if err != nil {
			t.Errorf("%v: %v", kase["id"], err)
			continue
		}
		if got, want := canonicalHost(t, reference.Value), canonicalCase(value); !slices.Equal(got, want) {
			t.Errorf("%v: the value is %v, expected %v", kase["id"], got, want)
		}
	}
	t.Logf("%d Reference cases", count)
}

// armed arms the faults for the member on this thread, calls it at once and returns the faults left (binding GN-8a).
func armed(t *testing.T, member, faults string, call func() error, check func(error)) ([]string, error) {
	t.Helper()
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	id, err := armFaults(t, member, faults)
	if err != nil {
		return nil, err
	}
	check(call())
	return faultLeft(id)
}
