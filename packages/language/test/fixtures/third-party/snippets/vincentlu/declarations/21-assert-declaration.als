assert noOrphans {
  all n: Node | some n.parent
}
