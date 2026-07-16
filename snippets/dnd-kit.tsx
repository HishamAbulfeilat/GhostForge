import * as React from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface SortableItemData {
  id: string;
  label: string;
}

interface SortableListProps {
  items: SortableItemData[];
  onChange?: (items: SortableItemData[]) => void;
}

export function SortableList({ items: initialItems, onChange }: SortableListProps) {
  const [items, setItems] = React.useState(initialItems);
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || active.id === over.id) {
      return;
    }

    setItems((currentItems) => {
      const oldIndex = currentItems.findIndex((item) => item.id === active.id);
      const newIndex = currentItems.findIndex((item) => item.id === over.id);
      const nextItems = arrayMove(currentItems, oldIndex, newIndex);
      onChange?.(nextItems);
      return nextItems;
    });
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={items} strategy={verticalListSortingStrategy}>
        <ul className="space-y-3">
          {items.map((item) => (
            <SortableRow key={item.id} item={item} />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

function SortableRow({ item }: { item: SortableItemData }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.id });

  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition
      }}
      className={`rounded-xl border border-slate-200 bg-white p-4 shadow-sm ${
        isDragging ? 'opacity-60' : ''
      }`}
    >
      <button
        type="button"
        className="flex w-full items-center justify-between text-start"
        {...attributes}
        {...listeners}
      >
        <span>{item.label}</span>
        <span className="text-slate-400">↕</span>
      </button>
    </li>
  );
}
