import { Search } from "lucide-react";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { useDebouncedCallback } from "@/hooks/useDebouncedCallback";

// Long enough to skip the requests for a word being typed, short enough to feel live.
const SEARCH_DEBOUNCE_MS = 250;

interface SearchInputProps {
  /** The search in the URL. */
  value: string;
  /** Called with the trimmed text once typing pauses. */
  onCommit: (q: string) => void;
}

export function SearchInput({ value, onCommit }: SearchInputProps) {
  const [text, setText] = useState(value);
  const [seenValue, setSeenValue] = useState(value);
  const commit = useDebouncedCallback(onCommit, SEARCH_DEBOUNCE_MS);

  // The URL moved on its own (Back, "Clear filters"): show its search. Our own commits
  // arrive trimmed, so compare trimmed, or a trailing space would be eaten mid-typing.
  if (value !== seenValue) {
    setSeenValue(value);
    if (value !== text.trim()) setText(value);
  }

  return (
    <div className="relative">
      <Search
        className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
        aria-hidden
      />
      <Input
        type="search"
        aria-label="Search names"
        placeholder="Search"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          commit(event.target.value.trim());
        }}
        className="w-56 pl-8"
      />
    </div>
  );
}
